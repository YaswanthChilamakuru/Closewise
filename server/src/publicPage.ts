import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "./db";
import { sessionUserId } from "./auth";
import { computeTotals } from "./proposals";
import { fmtDate, isExpired, notFoundPage, renderPage, type PublicProposal } from "./publicView";

// Client-facing proposal page: GET /p/:slug (server-rendered, no login) + small JSON actions.
// Presentation (HTML/CSS/browser script) lives in publicView.ts.

type Full = PublicProposal;

async function loadPublic(slug: string): Promise<Full | null> {
  if (!/^[a-f0-9]{8,64}$/i.test(slug)) return null;
  const p = await prisma.proposal.findUnique({
    where: { slug },
    include: { lineItems: true, user: { select: { id: true, name: true } } },
  });
  // Drafts are private: indistinguishable from a missing proposal.
  return p && p.status !== "DRAFT" ? p : null;
}

function securityHeaders(res: Response, nonce: string) {
  res.set({
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const publicRouter = Router();

publicRouter.get("/:slug", async (req: Request<{ slug: string }>, res) => {
  const nonce = crypto.randomBytes(16).toString("base64");
  securityHeaders(res, nonce);
  const p = await loadPublic(req.params.slug);
  if (!p) return res.status(404).type("html").send(notFoundPage(nonce));
  res.type("html").send(renderPage(p, { isOwner: sessionUserId(req) === p.userId, nonce }));
});

const jsonErr = (res: Response, status: number, error: string) => res.status(status).json({ error });

publicRouter.post("/:slug/view", async (req: Request<{ slug: string }>, res) => {
  const p = await loadPublic(req.params.slug);
  if (!p) return jsonErr(res, 404, "Not found");
  if (sessionUserId(req) === p.userId) return res.status(204).end(); // owner previewing
  await prisma.$transaction([
    prisma.activity.create({ data: { proposalId: p.id, type: "VIEWED", meta: {} } }),
    // First client view moves SENT → VIEWED; decided proposals keep their status.
    prisma.proposal.updateMany({ where: { id: p.id, status: "SENT" }, data: { status: "VIEWED" } }),
  ]);
  res.status(204).end();
});

const acceptSchema = z.object({
  name: z.string().trim().min(2, "Please type your full name").max(120),
  agree: z.literal(true, { error: "Please tick “I agree” to accept" }),
  selectedOptionalIds: z.array(z.string().max(64)).max(100).default([]),
});
const declineSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  selectedOptionalIds: z.array(z.string().max(64)).max(100).default([]),
});

/** Shared guards for accept/decline. Returns an error message or null. */
function decisionBlocked(p: Full): string | null {
  if (p.status === "ACCEPTED") return "This proposal has already been accepted.";
  if (p.status === "DECLINED") return "This proposal has already been declined.";
  if (isExpired(p)) return `This proposal expired on ${fmtDate(p.validUntil!)}. Please ask for an updated quote.`;
  return null;
}

publicRouter.post("/:slug/accept", async (req: Request<{ slug: string }>, res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) return jsonErr(res, 400, parsed.error.issues[0]?.message ?? "Invalid input");
  const p = await loadPublic(req.params.slug);
  if (!p) return jsonErr(res, 404, "This proposal is no longer available.");
  const blocked = decisionBlocked(p);
  if (blocked) return jsonErr(res, 409, blocked);

  const optionalIds = new Set(p.lineItems.filter((li) => li.optional).map((li) => li.id));
  const ids = [...new Set(parsed.data.selectedOptionalIds)];
  if (ids.some((id) => !optionalIds.has(id)))
    return jsonErr(res, 409, "The add-ons on this proposal have changed. Refresh the page and try again.");

  const totals = computeTotals(p.lineItems, ids);
  const addOns = p.lineItems.filter((li) => ids.includes(li.id)).map((li) => li.name);
  const now = new Date();
  const ok = await prisma.$transaction(async (tx) => {
    // Conditional update guards against a double-submit or a race with decline.
    const r = await tx.proposal.updateMany({
      where: { id: p.id, status: { in: ["SENT", "VIEWED"] } },
      data: { status: "ACCEPTED", acceptedBy: parsed.data.name, acceptedAt: now, selectedOptionalIds: ids },
    });
    if (r.count !== 1) return false;
    await tx.activity.create({
      data: {
        proposalId: p.id,
        type: "ACCEPTED",
        meta: { name: parsed.data.name, selectedOptionalIds: ids, addOns, total: totals.total, currency: p.currency },
      },
    });
    return true;
  });
  if (!ok) return jsonErr(res, 409, "This proposal has already been answered.");
  res.json({ ok: true, acceptedBy: parsed.data.name, acceptedAt: now.toISOString(), total: totals.total, currency: p.currency });
});

publicRouter.post("/:slug/decline", async (req: Request<{ slug: string }>, res) => {
  const parsed = declineSchema.safeParse(req.body);
  if (!parsed.success) return jsonErr(res, 400, parsed.error.issues[0]?.message ?? "Invalid input");
  const p = await loadPublic(req.params.slug);
  if (!p) return jsonErr(res, 404, "This proposal is no longer available.");
  const blocked = decisionBlocked(p);
  if (blocked) return jsonErr(res, 409, blocked);

  const optionalIds = new Set(p.lineItems.filter((li) => li.optional).map((li) => li.id));
  const ids = [...new Set(parsed.data.selectedOptionalIds)].filter((id) => optionalIds.has(id));
  const addOns = p.lineItems.filter((li) => ids.includes(li.id)).map((li) => li.name);
  const ok = await prisma.$transaction(async (tx) => {
    const r = await tx.proposal.updateMany({ where: { id: p.id, status: { in: ["SENT", "VIEWED"] } }, data: { status: "DECLINED" } });
    if (r.count !== 1) return false;
    await tx.activity.create({
      data: { proposalId: p.id, type: "DECLINED", meta: { reason: parsed.data.reason || null, selectedOptionalIds: ids, addOns } },
    });
    return true;
  });
  if (!ok) return jsonErr(res, 409, "This proposal has already been answered.");
  res.json({ ok: true });
});
