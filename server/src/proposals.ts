import crypto from "crypto";
import type { Activity, LineItem, Proposal } from "@prisma/client";
import { env } from "./env";

export type Section = { heading: string; body: string };

/** Number of minor-unit digits for a currency (INR/USD → 2, JPY → 0, KWD → 3). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

// Intl.NumberFormat accepts any well-formed code (e.g. "XYZ"), so check against real ISO 4217 codes.
const KNOWN_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

export function isValidCurrency(currency: string): boolean {
  return KNOWN_CURRENCIES.has(currency.toUpperCase());
}

/** Major units (e.g. 1499.50 rupees) → integer minor units (149950 paise). */
export function toMinor(major: number, currency: string): number {
  return Math.round(major * 10 ** currencyDigits(currency));
}

export function formatMoney(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const locale = currency === "INR" ? "en-IN" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits }).format(
    minor / 10 ** digits
  );
}

export function lineTotal(item: Pick<LineItem, "quantity" | "unitPrice">): number {
  return Math.round(item.quantity * item.unitPrice);
}

export type Totals = {
  /** Sum of required (non-optional) items. */
  base: number;
  /** Sum of all optional add-ons. */
  optionalAll: number;
  /** Sum of the optional add-ons the client selected on acceptance. */
  optionalSelected: number;
  /** base + selected add-ons — the amount the client owes. */
  total: number;
};

export function computeTotals(items: LineItem[], selectedOptionalIds: unknown = []): Totals {
  const selected = new Set(Array.isArray(selectedOptionalIds) ? selectedOptionalIds.map(String) : []);
  let base = 0;
  let optionalAll = 0;
  let optionalSelected = 0;
  for (const it of items) {
    const t = lineTotal(it);
    if (!it.optional) base += t;
    else {
      optionalAll += t;
      if (selected.has(it.id)) optionalSelected += t;
    }
  }
  return { base, optionalAll, optionalSelected, total: base + optionalSelected };
}

export function newSlug(): string {
  return crypto.randomBytes(8).toString("hex");
}

export const editUrl = (p: Pick<Proposal, "id">) => `${env.APP_URL}/proposals/${p.id}`;
export const publicUrl = (p: Pick<Proposal, "slug">) => `${env.APP_URL}/p/${p.slug}`;

export function asSections(json: unknown): Section[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((s): s is Section => !!s && typeof s === "object" && "heading" in s)
    .map((s) => ({ heading: String(s.heading ?? ""), body: String(s.body ?? "") }));
}

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const STATUS_HINT: Record<Proposal["status"], string> = {
  DRAFT: "Draft: not visible to the client yet. Call publish_proposal when it is ready to send.",
  SENT: "Published: the client can open the public link.",
  VIEWED: "The client has opened the proposal.",
  ACCEPTED: "Accepted by the client. It can no longer be edited.",
  DECLINED: "Declined by the client. It can no longer be edited.",
};

type FullProposal = Proposal & { lineItems: LineItem[]; activities?: Activity[] };

/** Plain-text summary returned by MCP tools. */
export function summarize(p: FullProposal, opts: { headline: string; full?: boolean; activityLimit?: number }): string {
  const items = [...p.lineItems].sort((a, b) => a.position - b.position);
  const t = computeTotals(items, p.selectedOptionalIds);
  const m = (n: number) => formatMoney(n, p.currency);
  const sections = asSections(p.sections);
  const out: string[] = [opts.headline, ""];

  out.push(`Title: ${p.title}`);
  out.push(`Client: ${p.clientName}${p.clientEmail ? ` <${p.clientEmail}>` : ""}`);
  out.push(`Status: ${p.status} (${STATUS_HINT[p.status]})`);
  out.push(`Currency: ${p.currency}${p.validUntil ? ` · Valid until: ${fmtDate(p.validUntil)}` : ""}`);
  out.push(`Proposal id: ${p.id}`);
  if (p.acceptedBy) out.push(`Accepted by: ${p.acceptedBy}${p.acceptedAt ? ` on ${fmtDate(p.acceptedAt)}` : ""}`);
  out.push("");

  if (opts.full) {
    out.push(`Sections (${sections.length}):`);
    sections.forEach((s, i) => out.push(``, `## ${i + 1}. ${s.heading}`, s.body));
    out.push("");
  } else {
    out.push(`Sections (${sections.length}): ${sections.map((s) => s.heading).join(" · ") || "none"}`);
    out.push("");
  }

  const fmtItem = (it: LineItem, i: number) =>
    `  ${i + 1}. ${it.name}: ${it.quantity} × ${m(it.unitPrice)} = ${m(lineTotal(it))}` +
    (it.description ? `\n     ${it.description}` : "") +
    (opts.full ? `\n     (line item id: ${it.id})` : "");
  const required = items.filter((i) => !i.optional);
  const optional = items.filter((i) => i.optional);
  out.push(`Line items (${required.length}):`);
  out.push(required.length ? required.map(fmtItem).join("\n") : "  none");
  if (optional.length) {
    out.push(`Optional add-ons (${optional.length}, the client can choose these when accepting):`);
    out.push(optional.map(fmtItem).join("\n"));
  }
  out.push("");
  out.push(`Total: ${m(t.base)}`);
  if (optional.length) {
    if (p.status === "ACCEPTED") out.push(`Selected add-ons: ${m(t.optionalSelected)} · Accepted total: ${m(t.total)}`);
    else out.push(`With all optional add-ons: ${m(t.base + t.optionalAll)}`);
  }
  out.push("");
  out.push(`Edit URL: ${editUrl(p)}`);
  out.push(`Public URL: ${publicUrl(p)}${p.status === "DRAFT" ? " (not visible to the client until published)" : ""}`);

  if (p.activities?.length) {
    const acts = [...p.activities].sort((a, b) => +b.createdAt - +a.createdAt).slice(0, opts.activityLimit ?? 20);
    out.push("", `Activity (latest ${acts.length}):`);
    for (const a of acts) {
      const meta = a.meta && typeof a.meta === "object" && Object.keys(a.meta).length ? ` ${JSON.stringify(a.meta)}` : "";
      out.push(`  - ${a.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC  ${a.type}${meta}`);
    }
  }
  return out.join("\n");
}
