import { Router, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "./db";
import {
  computeTotals,
  currencyDigits,
  formatMoney,
  isValidCurrency,
  newSlug,
  editUrl,
  publicUrl,
  summarize,
  toMinor,
  publishProblems,
  isProposalExpired,
  LOCKED_STATUSES as LOCKED,
} from "./proposals";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const STATUSES = ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED"] as const;

const sectionSchema = z.object({
  heading: z.string().trim().min(1).max(200).describe("Section heading, plain text, e.g. 'Scope of work'."),
  body: z
    .string()
    .max(20000)
    .describe(
      "Section content in Markdown (paragraphs, **bold**, bullet/numbered lists, links). Do not repeat the heading inside the body."
    ),
});

const lineItemSchema = z.object({
  name: z.string().trim().min(1).max(200).describe("Short name of the deliverable or service, e.g. 'Landing page design'."),
  description: z.string().max(1000).optional().describe("Optional one-line detail shown under the name."),
  quantity: z
    .number()
    .positive()
    .max(1_000_000)
    .default(1)
    .describe("Quantity (default 1). May be fractional, e.g. 2.5 hours."),
  unitPrice: z
    .number()
    .min(0)
    .max(1_000_000_000)
    .describe(
      "Price per unit in MAJOR units of the proposal currency, as a plain number: 45000 means ₹45,000 or $45,000, and 99.5 means $99.50. Do NOT send paise/cents; the server converts."
    ),
  optional: z
    .boolean()
    .default(false)
    .describe(
      "true = optional add-on the client can tick when accepting (it is not in the base total). Use this for upsells such as extra revisions, SEO, maintenance or rush delivery."
    ),
});

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Date in YYYY-MM-DD format.");

const currencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((s) => s.toUpperCase())
  .refine(isValidCurrency, "Unknown ISO 4217 currency code")
  .describe("ISO 4217 currency code, e.g. INR, USD, EUR, GBP.");

const idSchema = z.string().trim().min(1).describe("The proposal id (from create_proposal or list_proposals).");

const URL_NOTE =
  "The response is a plain-text summary with totals, the edit URL (where the freelancer can review and tweak it in the Closewise app) and the public URL (the link the client opens). Always show both URLs to the user.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

const toLineItemRows = (items: z.infer<typeof lineItemSchema>[], currency: string) =>
  items.map((it, i) => ({
    name: it.name,
    description: it.description?.trim() || null,
    quantity: it.quantity,
    unitPrice: toMinor(it.unitPrice, currency),
    optional: it.optional,
    position: i,
  }));

async function findOwned(user: User, id: string) {
  return prisma.proposal.findFirst({
    where: { userId: user.id, OR: [{ id }, { slug: id }] },
    include: { lineItems: true },
  });
}

const notFound = (id: string) =>
  fail(`No proposal with id "${id}" was found in this account. Call list_proposals to see the available proposal ids.`);


// ---------------------------------------------------------------------------
// MCP server (one per request: stateless)
// ---------------------------------------------------------------------------

function buildServer(user: User): McpServer {
  const server = new McpServer(
    { name: "closewise", version: "0.1.0" },
    {
      instructions:
        "Closewise stores and publishes sales proposals/quotes for a freelancer or small agency. You (Claude) write the proposal content; Closewise stores it, computes totals, hosts a public page for the client and tracks views/acceptance. Typical flow: gather the client's needs, then call create_proposal, show the user the summary and edit URL, refine with update_proposal, and call publish_proposal only when the user says it is ready to send. Prices are always given in major currency units (e.g. 45000 for ₹45,000).",
    }
  );

  // ----------------------------------------------------------------- create
  server.registerTool(
    "create_proposal",
    {
      title: "Create proposal",
      description: `Create a new DRAFT proposal (quote) for a client in the user's Closewise account.

Use this when the user asks you to write, draft or prepare a proposal, quote, estimate or pitch for a client. Do not use it to change an existing proposal; use update_proposal for that. If unsure whether one already exists, call list_proposals first.

How to write a good proposal:
- sections: 3–6 sections, each with a plain-text heading and a Markdown body. A good default structure: Overview/Understanding of the problem, Scope of work (bulleted deliverables), Timeline, Terms (payment schedule, revisions, what is out of scope). Write persuasive, specific, client-facing copy in the freelancer's voice. Never include prices in section text; pricing lives in lineItems so totals stay correct.
- lineItems: each priced deliverable. unitPrice is in MAJOR units of the currency (45000 = ₹45,000; 99.5 = $99.50). Never convert to paise/cents yourself; the server does it.
- Optional add-ons: when relevant, include 1–3 sensible upsells (e.g. extra revision round, SEO setup, monthly maintenance, rush delivery) as line items with optional: true. Clients can tick them when accepting; they are not counted in the base total.
- currency: use the currency the user/client works in (default INR). validUntil defaults to 30 days from today.

The proposal is created as a DRAFT and is NOT visible to the client until publish_proposal is called. Each call logs a CREATED activity. ${URL_NOTE}`,
      inputSchema: {
        title: z.string().trim().min(1).max(200).describe("Proposal title, e.g. 'Website redesign' or 'Brand identity package'."),
        clientName: z.string().trim().min(1).max(200).describe("Client's company or person name."),
        clientEmail: z.email().optional().describe("Client's email address, if known."),
        currency: currencySchema.default("INR"),
        validUntil: dateSchema.optional().describe("Date until which the quote is valid (YYYY-MM-DD). Defaults to 30 days from today."),
        sections: z.array(sectionSchema).min(1).max(20).describe("Ordered proposal sections; bodies are Markdown."),
        lineItems: z.array(lineItemSchema).min(1).max(100).describe("Priced line items in display order. Use optional: true for add-ons."),
      },
    },
    async (args) => {
      const validUntil = args.validUntil ? parseDate(args.validUntil) : new Date(Date.now() + 30 * 86_400_000);
      const p = await prisma.proposal.create({
        data: {
          userId: user.id,
          slug: newSlug(),
          title: args.title,
          clientName: args.clientName,
          clientEmail: args.clientEmail ?? null,
          currency: args.currency,
          validUntil,
          sections: args.sections,
          source: "CLAUDE",
          lineItems: { create: toLineItemRows(args.lineItems, args.currency) },
          activities: { create: { type: "CREATED", meta: { via: "mcp" } } },
        },
        include: { lineItems: true },
      });
      return text(
        summarize(p, { headline: `Created draft proposal "${p.title}" for ${p.clientName}.` }) +
          "\n\nNext: show the user this summary and the edit URL. When they confirm it is ready, call publish_proposal to make the public link live."
      );
    }
  );

  // ----------------------------------------------------------------- list
  server.registerTool(
    "list_proposals",
    {
      title: "List proposals",
      description: `List the user's proposals, newest first, with status, client, total and ids.

Use this to find a proposal's id before calling get_proposal, update_proposal or publish_proposal, to check whether a proposal for a client already exists, or to answer questions like "which proposals are still pending?" or "what got accepted this month?".

Optional status filter: DRAFT (not yet sent), SENT (published, not yet opened), VIEWED (client opened it), ACCEPTED, DECLINED. Read-only: it does not log activity. Each row includes the edit URL and public URL.`,
      inputSchema: {
        status: z.enum(STATUSES).optional().describe("Only return proposals with this status. Omit for all."),
        search: z.string().trim().max(100).optional().describe("Optional case-insensitive text to match in the title or client name."),
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of proposals to return (default 20, max 50)."),
      },
    },
    async ({ status, search, limit }) => {
      const where: Prisma.ProposalWhereInput = { userId: user.id };
      if (status) where.status = status;
      if (search)
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { clientName: { contains: search, mode: "insensitive" } },
        ];
      const [rows, count] = await Promise.all([
        prisma.proposal.findMany({ where, include: { lineItems: true }, orderBy: { updatedAt: "desc" }, take: limit }),
        prisma.proposal.count({ where }),
      ]);
      const filter = [status && `status ${status}`, search && `matching "${search}"`].filter(Boolean).join(", ");
      if (!rows.length) return text(`No proposals found${filter ? ` (${filter})` : ""}. Use create_proposal to draft one.`);

      const lines = rows.map((p, i) => {
        const t = computeTotals(p.lineItems, p.selectedOptionalIds);
        const amount = p.status === "ACCEPTED" ? t.total : t.base;
        const addOns = t.optionalAll && p.status !== "ACCEPTED" ? ` (+${formatMoney(t.optionalAll, p.currency)} optional)` : "";
        return [
          `${i + 1}. ${p.title}: ${p.clientName}`,
          `   Status: ${p.status}${isProposalExpired(p) ? " (EXPIRED: valid-until date has passed)" : ""} · Total: ${formatMoney(amount, p.currency)}${addOns} · Updated: ${p.updatedAt.toISOString().slice(0, 10)}`,
          `   id: ${p.id}`,
          `   Edit URL: ${editUrl(p)}`,
          `   Public URL: ${publicUrl(p)}${p.status === "DRAFT" ? " (draft, not live)" : ""}`,
        ].join("\n");
      });
      return text(
        `Showing ${rows.length} of ${count} proposal${count === 1 ? "" : "s"}${filter ? ` (${filter})` : ""}:\n\n${lines.join("\n\n")}`
      );
    }
  );

  // ----------------------------------------------------------------- get
  server.registerTool(
    "get_proposal",
    {
      title: "Get proposal",
      description: `Get one proposal in full: every section's Markdown body, all line items (with ids, quantities, unit prices and line totals), optional add-ons, computed totals, status, and the activity log (created, edited, published, viewed by the client, accepted/declined, with timestamps).

Use this before editing so you can see the current content (update_proposal replaces whole sections/lineItems lists), when the user asks about a proposal's details, or to check whether the client has viewed or accepted it. Accepts the proposal id or its public slug. Read-only: it does not log activity. ${URL_NOTE}`,
      inputSchema: {
        id: idSchema,
        activityLimit: z.number().int().min(1).max(100).default(20).describe("How many recent activity entries to include (default 20)."),
      },
    },
    async ({ id, activityLimit }) => {
      const p = await prisma.proposal.findFirst({
        where: { userId: user.id, OR: [{ id }, { slug: id }] },
        include: { lineItems: true, activities: { orderBy: { createdAt: "desc" }, take: activityLimit } },
      });
      if (!p) return notFound(id);
      return text(summarize(p, { headline: `Proposal "${p.title}"`, full: true, activityLimit }));
    }
  );

  // ----------------------------------------------------------------- update
  server.registerTool(
    "update_proposal",
    {
      title: "Update proposal",
      description: `Edit an existing proposal. Only the fields you pass are changed; omitted fields keep their current values.

Use this when the user asks to revise a proposal: rewrite copy, add or remove a section, change prices, add optional add-ons, fix client details, extend validity, and so on. Call get_proposal first if you have not seen the current content.

Important:
- sections and lineItems are REPLACED as whole lists when provided. To change one section or one price, send the complete list, including the unchanged entries. Section bodies are Markdown.
- unitPrice is in MAJOR units of the currency (45000 = ₹45,000; 99.5 = $99.50). Never send paise/cents.
- When it would help the deal, suggest or include optional add-ons (optional: true) such as extra revisions, maintenance or rush delivery.
- There is no exchange-rate conversion. When changing currency you should normally also send lineItems priced in the new currency. Without lineItems, the same major-unit amounts are kept (e.g. 500 USD becomes 500 EUR), and the change is refused if it would round prices (e.g. $99.50 to JPY).
- ACCEPTED or DECLINED proposals are locked and cannot be edited; create a new proposal instead.
- Editing an already published proposal updates the live public page immediately and keeps its status.

Each successful call logs an EDITED activity listing the changed fields. ${URL_NOTE}`,
      inputSchema: {
        id: idSchema,
        title: z.string().trim().min(1).max(200).optional().describe("New title."),
        clientName: z.string().trim().min(1).max(200).optional().describe("New client name."),
        clientEmail: z.email().nullable().optional().describe("New client email, or null to remove it."),
        currency: currencySchema.optional(),
        validUntil: dateSchema.nullable().optional().describe("New validity date (YYYY-MM-DD), or null for no expiry."),
        sections: z.array(sectionSchema).min(1).max(20).optional().describe("FULL replacement list of sections (Markdown bodies)."),
        lineItems: z.array(lineItemSchema).min(1).max(100).optional().describe("FULL replacement list of line items, with unitPrice in major units."),
      },
    },
    async (args) => {
      const existing = await findOwned(user, args.id);
      if (!existing) return notFound(args.id);
      if (LOCKED.has(existing.status))
        return fail(
          `"${existing.title}" is ${existing.status} and locked, so it cannot be edited. Create a new proposal with create_proposal instead.`
        );

      const data: Prisma.ProposalUpdateInput = {};
      const changed: string[] = [];
      if (args.title !== undefined) (data.title = args.title), changed.push("title");
      if (args.clientName !== undefined) (data.clientName = args.clientName), changed.push("clientName");
      if (args.clientEmail !== undefined) (data.clientEmail = args.clientEmail), changed.push("clientEmail");
      if (args.validUntil !== undefined)
        (data.validUntil = args.validUntil ? parseDate(args.validUntil) : null), changed.push("validUntil");
      if (args.sections !== undefined) (data.sections = args.sections), changed.push("sections");

      const currency = args.currency ?? existing.currency;
      if (args.currency !== undefined && args.currency !== existing.currency) {
        data.currency = args.currency;
        changed.push("currency");
      }
      if (data.currency && args.lineItems === undefined) {
        const shift = currencyDigits(currency) - currencyDigits(existing.currency);
        const lossy = shift < 0 && existing.lineItems.some((li) => li.unitPrice % 10 ** -shift !== 0);
        if (lossy)
          return fail(
            `Changing currency from ${existing.currency} to ${currency} would round some prices (${currency} has ${currencyDigits(currency)} decimal places). Send lineItems with prices in ${currency} together with the currency change.`
          );
      }
      if (!changed.length && args.lineItems === undefined)
        return fail("Nothing to update: pass at least one field to change (title, clientName, clientEmail, currency, validUntil, sections or lineItems).");

      const p = await prisma.$transaction(async (tx) => {
        if (args.lineItems !== undefined) {
          await tx.lineItem.deleteMany({ where: { proposalId: existing.id } });
          await tx.lineItem.createMany({
            data: toLineItemRows(args.lineItems, currency).map((r) => ({ ...r, proposalId: existing.id })),
          });
          // Selected add-on ids refer to deleted rows now.
          data.selectedOptionalIds = [];
          changed.push("lineItems");
        } else if (data.currency) {
          // Keep the same major-unit amounts when the minor-unit precision differs (e.g. INR → JPY).
          const shift = currencyDigits(currency) - currencyDigits(existing.currency);
          if (shift !== 0)
            for (const li of existing.lineItems)
              await tx.lineItem.update({ where: { id: li.id }, data: { unitPrice: Math.round(li.unitPrice * 10 ** shift) } });
        }
        await tx.activity.create({ data: { proposalId: existing.id, type: "EDITED", meta: { via: "mcp", fields: changed } } });
        return tx.proposal.update({ where: { id: existing.id }, data, include: { lineItems: true } });
      });

      return text(summarize(p, { headline: `Updated "${p.title}" (changed: ${changed.join(", ")}).` }));
    }
  );

  // ----------------------------------------------------------------- publish
  server.registerTool(
    "publish_proposal",
    {
      title: "Publish proposal",
      description: `Publish a proposal so the client can open it at its public URL (status DRAFT → SENT), and return the link to share.

Use this ONLY when the user explicitly says the proposal is ready to send or asks for the client link. Do not publish right after creating a draft without the user's confirmation. After publishing, give the user the public URL to send to the client. Closewise then tracks when the client views, accepts or declines it.

Requirements: at least one section and at least one non-optional line item. Calling it on an already published proposal (SENT/VIEWED) simply returns the link again. ACCEPTED/DECLINED proposals cannot be republished. Logs a PUBLISHED activity when the status changes. ${URL_NOTE}`,
      inputSchema: { id: idSchema },
    },
    async ({ id }) => {
      const existing = await findOwned(user, id);
      if (!existing) return notFound(id);
      if (LOCKED.has(existing.status))
        return fail(`"${existing.title}" is already ${existing.status}; it cannot be published again. Public URL: ${publicUrl(existing)}`);
      if (existing.status === "SENT" || existing.status === "VIEWED")
        return text(
          summarize(existing, { headline: `"${existing.title}" is already published (${existing.status}). Share this link with the client: ${publicUrl(existing)}` })
        );

      const problems = publishProblems(existing);
      if (problems.length)
        return fail(`Cannot publish "${existing.title}": ${problems.join(" and ")}. Fix it with update_proposal, then publish again.`);

      const p = await prisma.$transaction(async (tx) => {
        await tx.activity.create({ data: { proposalId: existing.id, type: "PUBLISHED", meta: { via: "mcp" } } });
        return tx.proposal.update({ where: { id: existing.id }, data: { status: "SENT" }, include: { lineItems: true } });
      });
      return text(
        summarize(p, { headline: `Published "${p.title}". It is live for ${p.clientName}.` }) +
          `\n\nSend the client this link: ${publicUrl(p)}`
      );
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP routes: POST /mcp/:token (stateless Streamable HTTP)
// ---------------------------------------------------------------------------

const rpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

export const mcpRouter = Router();

mcpRouter.post("/:token", async (req: Request<{ token: string }>, res: Response) => {
  let user: User | null = null;
  try {
    user = await prisma.user.findUnique({ where: { mcpToken: req.params.token } });
  } catch (err) {
    console.error("MCP auth lookup failed:", err);
    return rpcError(res, 500, -32603, "Internal server error");
  }
  if (!user) return rpcError(res, 401, -32001, "Invalid MCP token. Copy the MCP URL again from your Closewise settings.");

  const server = buildServer(user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) rpcError(res, 500, -32603, "Internal server error");
  }
});

// Stateless server: no SSE stream to resume and no session to delete.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.set("Allow", "POST");
  rpcError(res, 405, -32000, "Method not allowed. This MCP server is stateless; use POST.");
};
mcpRouter.get("/:token", methodNotAllowed);
mcpRouter.delete("/:token", methodNotAllowed);
