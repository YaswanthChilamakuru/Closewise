import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, type Activity, type LineItem, type Proposal } from "@prisma/client";
import { prisma } from "./db";
import { authRouter, newMcpToken, publicUser, requireUser, type AuthedRequest } from "./auth";
import {
  LOCKED_STATUSES,
  asSections,
  computeTotals,
  currencyDigits,
  editUrl,
  newSlug,
  publicUrl,
  publishProblems,
  toMinor,
} from "./proposals";

// ---------------------------------------------------------------------------
// Serialisation (money: line item prices in MAJOR units for editing, totals in MINOR units + digits)
// ---------------------------------------------------------------------------

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const byPosition = (items: LineItem[]) => [...items].sort((a, b) => a.position - b.position);

function listRow(p: Proposal & { lineItems: LineItem[] }) {
  return {
    id: p.id,
    title: p.title,
    clientName: p.clientName,
    status: p.status,
    source: p.source,
    currency: p.currency,
    digits: currencyDigits(p.currency),
    totals: computeTotals(p.lineItems, p.selectedOptionalIds),
    validUntil: ymd(p.validUntil),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function fullProposal(p: Proposal & { lineItems: LineItem[]; activities: Activity[] }) {
  const digits = currencyDigits(p.currency);
  return {
    ...listRow(p),
    slug: p.slug,
    clientEmail: p.clientEmail ?? "",
    sections: asSections(p.sections),
    acceptedBy: p.acceptedBy,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    selectedOptionalIds: Array.isArray(p.selectedOptionalIds) ? p.selectedOptionalIds.map(String) : [],
    createdAt: p.createdAt.toISOString(),
    lineItems: byPosition(p.lineItems).map((li) => ({
      id: li.id,
      name: li.name,
      description: li.description ?? "",
      quantity: li.quantity,
      unitPrice: li.unitPrice / 10 ** digits,
      optional: li.optional,
    })),
    activities: [...p.activities]
      .sort((a, b) => +b.createdAt - +a.createdAt)
      .map((a) => ({ id: a.id, type: a.type, meta: a.meta, createdAt: a.createdAt.toISOString() })),
    editUrl: editUrl(p),
    publicUrl: publicUrl(p),
    locked: LOCKED_STATUSES.has(p.status),
  };
}

const fullInclude = { lineItems: true, activities: { orderBy: { createdAt: "desc" }, take: 50 } } as const;

async function loadOwned(userId: string, id: string) {
  return prisma.proposal.findFirst({ where: { id, userId }, include: fullInclude });
}

const userOf = (req: Request) => (req as AuthedRequest).user;
const bad = (res: Response, status: number, error: string) => res.status(status).json({ error });
const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}` : "Invalid input";
};

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

type Money = { currency: string; digits: number; amount: number };

function addMoney(map: Map<string, number>, currency: string, amount: number) {
  map.set(currency, (map.get(currency) ?? 0) + amount);
}
const moneyList = (map: Map<string, number>): Money[] =>
  [...map.entries()]
    .map(([currency, amount]) => ({ currency, digits: currencyDigits(currency), amount }))
    .sort((a, b) => b.amount - a.amount);

function computeStats(rows: (Proposal & { lineItems: LineItem[] })[]) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const open = new Map<string, number>();
  const acceptedMonth = new Map<string, number>();
  let acceptedThisMonthCount = 0;
  let sentCount = 0;
  let acceptedCount = 0;
  let openCount = 0;
  for (const p of rows) {
    const t = computeTotals(p.lineItems, p.selectedOptionalIds);
    if (p.status !== "DRAFT") sentCount++;
    if (p.status === "SENT" || p.status === "VIEWED") {
      openCount++;
      addMoney(open, p.currency, t.base);
    }
    if (p.status === "ACCEPTED") {
      acceptedCount++;
      if (p.acceptedAt && p.acceptedAt >= monthStart) {
        acceptedThisMonthCount++;
        addMoney(acceptedMonth, p.currency, t.total);
      }
    }
  }
  return {
    openValue: moneyList(open),
    openCount,
    acceptedThisMonth: moneyList(acceptedMonth),
    acceptedThisMonthCount,
    /** Accepted ÷ everything ever sent (non-draft). null when nothing has been sent yet. */
    acceptanceRate: sentCount ? acceptedCount / sentCount : null,
    acceptedCount,
    sentCount,
  };
}

// ---------------------------------------------------------------------------
// Validation for the editor's autosave (lenient while drafting; publish enforces completeness)
// ---------------------------------------------------------------------------

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const patchSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  clientName: z.string().trim().min(1, "Client name is required").max(200).optional(),
  clientEmail: z
    .union([z.literal(""), z.email("Enter a valid client email")])
    .nullable()
    .optional(),
  validUntil: dateSchema.nullable().optional(),
  sections: z
    .array(z.object({ heading: z.string().max(200), body: z.string().max(20000) }))
    .max(20)
    .optional(),
  lineItems: z
    .array(
      z.object({
        // Client-generated id (UUID) for new rows, so React keys stay stable across autosaves.
        id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
        name: z.string().max(200),
        description: z.string().max(1000).optional(),
        quantity: z.number().positive("Quantity must be more than 0").max(1_000_000),
        unitPrice: z.number().min(0, "Price can't be negative").max(1_000_000_000),
        optional: z.boolean(),
      })
    )
    .max(100)
    .optional(),
});

const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const EDIT_COALESCE_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const apiRouter = Router();

apiRouter.get("/ping", (_req, res) => {
  res.json({ ok: true });
});

apiRouter.use("/auth", authRouter);

// Everything below requires a signed-in user.
apiRouter.use(requireUser);

apiRouter.get("/me", (req, res) => {
  res.json({ user: publicUser(userOf(req)) });
});

apiRouter.post("/me/mcp-token", async (req, res) => {
  const user = await prisma.user.update({ where: { id: userOf(req).id }, data: { mcpToken: newMcpToken() } });
  res.json({ user: publicUser(user) });
});

apiRouter.get("/proposals", async (req, res) => {
  const rows = await prisma.proposal.findMany({
    where: { userId: userOf(req).id },
    include: { lineItems: true },
    orderBy: { updatedAt: "desc" },
  });
  res.set("Cache-Control", "no-store").json({ proposals: rows.map(listRow), stats: computeStats(rows) });
});

apiRouter.post("/proposals", async (req, res) => {
  const p = await prisma.proposal.create({
    data: {
      userId: userOf(req).id,
      slug: newSlug(),
      title: "Untitled proposal",
      clientName: "New client",
      validUntil: new Date(Date.now() + 30 * 86_400_000),
      source: "MANUAL",
      sections: [
        { heading: "Overview", body: "" },
        { heading: "Scope of work", body: "" },
        { heading: "Timeline", body: "" },
        { heading: "Terms", body: "" },
      ],
      lineItems: { create: [{ name: "", quantity: 1, unitPrice: 0, position: 0 }] },
      activities: { create: { type: "CREATED", meta: { via: "web" } } },
    },
    include: fullInclude,
  });
  res.status(201).json({ proposal: fullProposal(p) });
});

apiRouter.get("/proposals/:id", async (req: Request<{ id: string }>, res) => {
  const p = await loadOwned(userOf(req).id, req.params.id);
  if (!p) return bad(res, 404, "Proposal not found");
  res.set("Cache-Control", "no-store").json({ proposal: fullProposal(p) });
});

apiRouter.patch("/proposals/:id", async (req: Request<{ id: string }>, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, firstIssue(parsed.error));
  const body = parsed.data;

  const existing = await loadOwned(userOf(req).id, req.params.id);
  if (!existing) return bad(res, 404, "Proposal not found");
  if (LOCKED_STATUSES.has(existing.status))
    return bad(res, 409, `This proposal is ${existing.status.toLowerCase()} and can no longer be edited.`);

  const data: Prisma.ProposalUpdateInput = {};
  const changed: string[] = [];
  if (body.title !== undefined && body.title !== existing.title) (data.title = body.title), changed.push("title");
  if (body.clientName !== undefined && body.clientName !== existing.clientName)
    (data.clientName = body.clientName), changed.push("clientName");
  if (body.clientEmail !== undefined) {
    const v = body.clientEmail || null;
    if (v !== existing.clientEmail) (data.clientEmail = v), changed.push("clientEmail");
  }
  if (body.validUntil !== undefined && body.validUntil !== ymd(existing.validUntil))
    (data.validUntil = body.validUntil ? parseDate(body.validUntil) : null), changed.push("validUntil");
  if (body.sections !== undefined && !sameJson(body.sections, asSections(existing.sections)))
    (data.sections = body.sections), changed.push("sections");

  // Line items: upsert by id so unchanged rows (and their ids) survive autosave.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (body.lineItems !== undefined) {
    const current = new Map(existing.lineItems.map((li) => [li.id, li]));
    const incoming = new Set(body.lineItems.map((li) => li.id));
    if (incoming.size !== body.lineItems.length) return bad(res, 400, "Duplicate line item ids");
    body.lineItems.forEach((li, position) => {
      const row = {
        name: li.name.trim(),
        description: li.description?.trim() || null,
        quantity: li.quantity,
        unitPrice: toMinor(li.unitPrice, existing.currency),
        optional: li.optional,
        position,
      };
      const old = current.get(li.id);
      if (!old) ops.push(prisma.lineItem.create({ data: { id: li.id, proposalId: existing.id, ...row } }));
      else if (
        old.name !== row.name ||
        old.description !== row.description ||
        old.quantity !== row.quantity ||
        old.unitPrice !== row.unitPrice ||
        old.optional !== row.optional ||
        old.position !== row.position
      )
        ops.push(prisma.lineItem.update({ where: { id: li.id }, data: row }));
    });
    const removed = existing.lineItems.filter((li) => !incoming.has(li.id)).map((li) => li.id);
    if (removed.length) ops.push(prisma.lineItem.deleteMany({ where: { id: { in: removed }, proposalId: existing.id } }));
    if (ops.length) changed.push("lineItems");
  }

  if (!changed.length) return res.json({ proposal: fullProposal(existing) });

  // Autosave fires often: fold edits within a few minutes into one EDITED activity.
  const last = existing.activities[0];
  const lastMeta = (last?.meta ?? {}) as { via?: string; fields?: string[] };
  if (last && last.type === "EDITED" && lastMeta.via === "web" && Date.now() - +last.createdAt < EDIT_COALESCE_MS) {
    const fields = [...new Set([...(lastMeta.fields ?? []), ...changed])];
    ops.push(prisma.activity.update({ where: { id: last.id }, data: { meta: { via: "web", fields }, createdAt: new Date() } }));
  } else {
    ops.push(prisma.activity.create({ data: { proposalId: existing.id, type: "EDITED", meta: { via: "web", fields: changed } } }));
  }
  // Always touch the proposal so updatedAt reflects line-item-only edits too.
  ops.push(prisma.proposal.update({ where: { id: existing.id }, data: { ...data, updatedAt: new Date() } }));

  try {
    await prisma.$transaction(ops);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      return bad(res, 409, "Line item id conflict. Reload the page and try again.");
    throw err;
  }
  const p = await loadOwned(userOf(req).id, existing.id);
  res.json({ proposal: fullProposal(p!) });
});

apiRouter.post("/proposals/:id/publish", async (req: Request<{ id: string }>, res) => {
  const existing = await loadOwned(userOf(req).id, req.params.id);
  if (!existing) return bad(res, 404, "Proposal not found");
  if (LOCKED_STATUSES.has(existing.status))
    return bad(res, 409, `This proposal is already ${existing.status.toLowerCase()}.`);
  if (existing.status === "SENT" || existing.status === "VIEWED") return res.json({ proposal: fullProposal(existing) });

  const problems = publishProblems(existing);
  if (problems.length) return bad(res, 422, `Can't publish yet: ${problems.join(", ")}.`);

  await prisma.$transaction([
    prisma.activity.create({ data: { proposalId: existing.id, type: "PUBLISHED", meta: { via: "web" } } }),
    prisma.proposal.update({ where: { id: existing.id }, data: { status: "SENT" } }),
  ]);
  const p = await loadOwned(userOf(req).id, existing.id);
  res.json({ proposal: fullProposal(p!) });
});

apiRouter.use((_req, res) => {
  bad(res, 404, "Not found");
});
