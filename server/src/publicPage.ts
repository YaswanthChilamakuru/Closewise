import crypto from "crypto";
import MarkdownIt from "markdown-it";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { LineItem, Proposal, User } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { sessionUserId } from "./auth";
import { asSections, computeTotals, currencyDigits, formatMoney, lineTotal } from "./proposals";

// Client-facing proposal page: GET /p/:slug (server-rendered, no login) + small JSON actions.

// html: false (default) escapes raw HTML; markdown-it also rejects javascript:/vbscript:/data: links.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, options, envArg, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer nofollow");
  return defaultLink(tokens, idx, options, envArg, self);
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString("en-US", { maximumFractionDigits: 2 }));

type Full = Proposal & { lineItems: LineItem[]; user: Pick<User, "id" | "name"> };

async function loadPublic(slug: string): Promise<Full | null> {
  if (!/^[a-f0-9]{8,64}$/i.test(slug)) return null;
  const p = await prisma.proposal.findUnique({
    where: { slug },
    include: { lineItems: true, user: { select: { id: true, name: true } } },
  });
  // Drafts are private: indistinguishable from a missing proposal.
  return p && p.status !== "DRAFT" ? p : null;
}

/** Start of today in UTC; validUntil is stored as a UTC date (midnight). The quote is valid through that day. */
const isExpired = (p: Proposal) => !!p.validUntil && p.validUntil.getTime() + 86_400_000 <= Date.now();

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
// HTML
// ---------------------------------------------------------------------------

const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;

const CSS = `
:root{--bg:#f4f4f5;--card:#fff;--ink:#18181b;--ink2:#3f3f46;--muted:#71717a;--faint:#a1a1aa;--line:#e4e4e7;--line2:#f4f4f5;--accent:#4f46e5;--accent-d:#4338ca;--accent-l:#eef2ff;--ok:#059669;--ok-l:#ecfdf5;--bad:#e11d48;--bad-l:#fff1f2;--warn:#b45309;--warn-l:#fffbeb}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
a{color:var(--accent)}
.wrap{max-width:820px;margin:0 auto;padding:40px 16px 32px}
.paper{background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 32px -12px rgba(0,0,0,.08);overflow:hidden}
.band{height:6px;background:linear-gradient(90deg,var(--accent),#818cf8)}
.pad{padding:40px 48px}
@media (max-width:640px){.pad{padding:28px 20px}.wrap{padding-top:16px}}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:30px;line-height:1.2;letter-spacing:-.02em;margin:10px 0 0;font-weight:700}
@media (max-width:640px){h1{font-size:24px}}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-top:28px;padding-top:24px;border-top:1px solid var(--line)}
.meta dt{font-size:12px;color:var(--muted);margin:0}
.meta dd{margin:2px 0 0;font-weight:600;font-size:14px}
.notice{display:flex;gap:10px;align-items:flex-start;border-radius:12px;padding:12px 14px;font-size:14px;margin:0 48px 0}
@media (max-width:640px){.notice{margin:0 20px}}
.notice svg{flex:none;margin-top:2px}
.n-ok{background:var(--ok-l);color:#065f46}.n-bad{background:var(--bad-l);color:#9f1239}.n-warn{background:var(--warn-l);color:#92400e}.n-info{background:var(--accent-l);color:#3730a3}
section.s{padding:0 48px;margin-top:36px}
@media (max-width:640px){section.s{padding:0 20px;margin-top:28px}}
section.s h2{font-size:18px;letter-spacing:-.01em;margin:0 0 10px;font-weight:650}
.prose{color:var(--ink2)}
.prose p{margin:0 0 12px}.prose ul,.prose ol{margin:0 0 12px;padding-left:22px}.prose li{margin:3px 0}.prose li::marker{color:var(--faint)}
.prose strong{color:var(--ink);font-weight:600}.prose h1,.prose h2,.prose h3,.prose h4{font-size:15px;color:var(--ink);margin:16px 0 6px}
.prose blockquote{margin:0 0 12px;padding-left:14px;border-left:3px solid var(--line);color:var(--muted)}
.prose code{background:var(--line2);border-radius:4px;padding:1px 5px;font-size:13px}
.prose table{border-collapse:collapse;margin:0 0 12px;font-size:14px}.prose th,.prose td{border:1px solid var(--line);padding:6px 10px;text-align:left}
.prose>:last-child{margin-bottom:0}
.price{margin-top:44px;padding:32px 48px 8px;border-top:1px solid var(--line)}
@media (max-width:640px){.price{padding:24px 20px 4px}}
.price h2{font-size:18px;margin:0 0 4px;font-weight:650;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:14px;margin:0 0 16px}
.items{width:100%;border-collapse:collapse;font-size:14px}
.items th{font-size:12px;font-weight:500;color:var(--muted);text-align:left;padding:8px 0;border-bottom:1px solid var(--line)}
.items td{padding:14px 0;border-bottom:1px solid var(--line2);vertical-align:top}
.items .num{text-align:right;white-space:nowrap;padding-left:16px;font-variant-numeric:tabular-nums}
.items .nm{font-weight:600;color:var(--ink)}.items .ds{color:var(--muted);font-size:13px;margin-top:2px}
.items .qx{color:var(--muted);font-size:13px}
@media (max-width:640px){.items .hide-sm{display:none}}
.opt-h{margin:28px 0 4px;font-size:15px;font-weight:650}
.opt{display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border:1px solid var(--line);border-radius:14px;margin-top:10px;cursor:pointer;transition:border-color .15s,background .15s}
.opt:hover{border-color:#c7d2fe}
.opt.on{border-color:var(--accent);background:var(--accent-l)}
.opt.ro{cursor:default}
.opt input{appearance:none;flex:none;width:20px;height:20px;margin:2px 0 0;border:1.5px solid #d4d4d8;border-radius:6px;background:#fff;display:grid;place-content:center;cursor:inherit}
.opt input:checked{background:var(--accent);border-color:var(--accent)}
.opt input:checked::after{content:"";width:10px;height:6px;border:2px solid #fff;border-top:0;border-right:0;transform:rotate(-45deg) translate(1px,-1px)}
.opt input:focus-visible{outline:3px solid #c7d2fe;outline-offset:1px}
.opt .body{flex:1;min-width:0}.opt .amt{font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.totals{margin:24px 0 0 auto;max-width:320px;font-size:14px}
.totals .r{display:flex;justify-content:space-between;padding:4px 0;color:var(--ink2)}
.totals .r span:last-child{font-variant-numeric:tabular-nums}
.totals .grand{border-top:1px solid var(--line);margin-top:8px;padding-top:12px;color:var(--ink);font-weight:700;font-size:20px;letter-spacing:-.01em;align-items:baseline}
.totals .grand span:first-child{font-size:15px}
.actions{display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap;padding:28px 48px 40px}
@media (max-width:640px){.actions{padding:24px 20px 28px}.actions .btn{flex:1}}
.btn{appearance:none;border:0;border-radius:12px;font:600 15px/1 Inter,system-ui,sans-serif;padding:14px 22px;cursor:pointer;transition:background .15s,box-shadow .15s,opacity .15s;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}
.btn:focus-visible{outline:3px solid #c7d2fe;outline-offset:2px}
.btn-p{background:var(--accent);color:#fff;box-shadow:0 1px 2px rgba(79,70,229,.3)}.btn-p:hover{background:var(--accent-d)}
.btn-s{background:#fff;color:var(--ink2);border:1px solid var(--line)}.btn-s:hover{background:#fafafa}
.btn-g{background:transparent;color:var(--muted);padding:14px 12px}.btn-g:hover{color:var(--ink)}
.btn-d{background:var(--bad);color:#fff}.btn-d:hover{background:#be123c}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.foot{text-align:center;color:var(--faint);font-size:12px;margin-top:24px}
.foot a{color:var(--muted);text-decoration:none;font-weight:500}.foot a:hover{color:var(--accent)}
.printbar{display:flex;justify-content:flex-end;margin-bottom:12px}
dialog{border:0;border-radius:20px;padding:0;width:min(440px,calc(100vw - 32px));box-shadow:0 24px 64px -12px rgba(0,0,0,.25);color:var(--ink)}
dialog::backdrop{background:rgba(24,24,27,.35);backdrop-filter:blur(2px)}
.dlg{padding:28px}
.dlg h3{margin:0;font-size:18px;letter-spacing:-.01em}
.dlg p{margin:8px 0 0;color:var(--muted);font-size:14px}
.dlg .sum{margin-top:18px;background:var(--line2);border-radius:12px;padding:12px 14px;font-size:14px}
.dlg .sum .r{display:flex;justify-content:space-between;gap:12px}.dlg .sum .r+.r{margin-top:4px}
.dlg .sum b{font-variant-numeric:tabular-nums}
.dlg label.f{display:block;font-size:13px;font-weight:500;color:var(--ink2);margin-top:18px}
.dlg input[type=text],.dlg textarea{display:block;width:100%;margin-top:6px;border:1px solid var(--line);border-radius:10px;padding:11px 12px;font:15px Inter,system-ui,sans-serif;color:var(--ink);background:#fff}
.dlg textarea{min-height:84px;resize:vertical}
.dlg input[type=text]:focus,.dlg textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px #e0e7ff}
.agree{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:14px;color:var(--ink2);cursor:pointer}
.agree input{width:18px;height:18px;margin:2px 0 0;accent-color:var(--accent);flex:none}
.dlg .err{display:none;margin-top:14px;background:var(--bad-l);color:#9f1239;border-radius:10px;padding:10px 12px;font-size:14px}
.dlg .row{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}
.done{text-align:center;padding:64px 32px 56px}
.done .ic{width:64px;height:64px;border-radius:50%;margin:0 auto;display:grid;place-items:center}
.done h2{font-size:26px;letter-spacing:-.02em;margin:22px 0 0}
.done p{color:var(--muted);margin:10px auto 0;max-width:440px}
.done .sum{max-width:360px;margin:28px auto 0;text-align:left;border:1px solid var(--line);border-radius:14px;padding:16px 18px;font-size:14px}
.done .sum .r{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
.done .sum .r span:first-child{color:var(--muted)}
.done .sum .r b{font-variant-numeric:tabular-nums;text-align:right}
.done .btns{margin-top:28px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
[hidden]{display:none!important}
@media print{
  @page{margin:16mm}
  body{background:#fff;font-size:12.5px}
  .wrap{max-width:none;padding:0}
  .paper{border:0;box-shadow:none;border-radius:0}
  .band,.actions,.printbar,.foot a.cta,dialog,.notice.n-info,.no-print{display:none!important}
  .pad,section.s,.price{padding-left:0;padding-right:0}
  .notice{margin:0}
  .opt{break-inside:avoid;border-color:#d4d4d8}.opt.on{background:#fff}
  .opt input{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .items tr,.totals,section.s{break-inside:avoid}
  a{color:inherit;text-decoration:none}
  .foot{margin-top:32px}
}`;

const ICON = {
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  alert: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`,
  print: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>`,
};

function layout(title: string, body: string, nonce: string, script = "") {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%234f46e5'/%3E%3Cpath d='M9 16.5l4.5 4.5L23 11.5' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
${FONT}<style nonce="${nonce}">${CSS}</style>
</head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

const footer = () =>
  `<p class="foot">Made with <a class="cta" href="${esc(env.APP_URL)}/" target="_blank" rel="noopener">Closewise</a></p>`;

function notFoundPage(nonce: string) {
  return layout(
    "Proposal not found",
    `<div class="wrap"><div class="paper"><div class="band"></div><div class="done">
      <div class="ic" style="background:var(--line2);color:var(--muted)">${ICON.alert.replace(/16/g, "28")}</div>
      <h2>Proposal not found</h2>
      <p>This link may be mistyped, or the proposal hasn't been shared yet. Ask the sender for an up-to-date link.</p>
    </div></div>${footer()}</div>`,
    nonce
  );
}

function renderPage(p: Full, opts: { isOwner: boolean; nonce: string }) {
  const digits = currencyDigits(p.currency);
  const m = (minor: number) => formatMoney(minor, p.currency);
  const items = [...p.lineItems].sort((a, b) => a.position - b.position);
  const required = items.filter((i) => !i.optional);
  const optional = items.filter((i) => i.optional);
  const totals = computeTotals(items, p.selectedOptionalIds);
  const selected = new Set(Array.isArray(p.selectedOptionalIds) ? p.selectedOptionalIds.map(String) : []);
  const decided = p.status === "ACCEPTED" || p.status === "DECLINED";
  const expired = !decided && isExpired(p);
  const interactive = !decided && !expired;
  const sections = asSections(p.sections);
  const from = p.user.name;

  const notices: string[] = [];
  if (p.status === "ACCEPTED")
    notices.push(
      `<div class="notice n-ok">${ICON.check}<span><b>Accepted</b>${p.acceptedBy ? ` by ${esc(p.acceptedBy)}` : ""}${p.acceptedAt ? ` on ${fmtDate(p.acceptedAt)}` : ""}. Thank you!</span></div>`
    );
  if (p.status === "DECLINED") notices.push(`<div class="notice n-bad">${ICON.alert}<span>This proposal was declined.</span></div>`);
  if (expired && p.validUntil)
    notices.push(
      `<div class="notice n-warn">${ICON.alert}<span>This proposal expired on ${fmtDate(p.validUntil)}. Contact ${esc(from)} for an updated quote.</span></div>`
    );
  if (opts.isOwner)
    notices.push(
      `<div class="notice n-info">${ICON.alert}<span>You're viewing your own proposal. Your visits aren't recorded as client views.</span></div>`
    );

  const reqRows = required
    .map(
      (it) => `<tr>
        <td><div class="nm">${esc(it.name)}</div>${it.description ? `<div class="ds">${esc(it.description)}</div>` : ""}${it.quantity !== 1 ? `<div class="qx">${fmtQty(it.quantity)} × ${m(it.unitPrice)}</div>` : ""}</td>
        <td class="num hide-sm">${fmtQty(it.quantity)}</td>
        <td class="num hide-sm">${m(it.unitPrice)}</td>
        <td class="num"><b>${m(lineTotal(it))}</b></td>
      </tr>`
    )
    .join("");

  const optRows = optional
    .map((it) => {
      const on = selected.has(it.id);
      return `<label class="opt${on ? " on" : ""}${interactive ? "" : " ro"}">
        <input type="checkbox" name="addon" value="${esc(it.id)}"${on ? " checked" : ""}${interactive ? "" : " disabled"}>
        <span class="body"><span class="nm" style="font-weight:600">${esc(it.name)}</span>${it.description ? `<span class="ds" style="display:block;color:var(--muted);font-size:13px;margin-top:2px">${esc(it.description)}</span>` : ""}${it.quantity !== 1 ? `<span class="qx" style="display:block;color:var(--muted);font-size:13px">${fmtQty(it.quantity)} × ${m(it.unitPrice)}</span>` : ""}</span>
        <span class="amt">+ ${m(lineTotal(it))}</span>
      </label>`;
    })
    .join("");

  const addOnsShown = p.status === "ACCEPTED" ? totals.optionalSelected : 0;
  const totalShown = p.status === "ACCEPTED" ? totals.total : totals.base;

  const body = `<div class="wrap">
  <div class="printbar no-print"><button class="btn btn-g" type="button" id="print">${ICON.print} Save as PDF</button></div>
  <main class="paper" id="proposal">
    <div class="band"></div>
    <header class="pad">
      <div class="eyebrow">Proposal from ${esc(from)}</div>
      <h1>${esc(p.title)}</h1>
      <dl class="meta">
        <div><dt>Prepared for</dt><dd>${esc(p.clientName)}</dd></div>
        <div><dt>Prepared by</dt><dd>${esc(from)}</dd></div>
        <div><dt>Date</dt><dd>${fmtDate(p.createdAt)}</dd></div>
        ${p.validUntil ? `<div><dt>Valid until</dt><dd>${fmtDate(p.validUntil)}</dd></div>` : ""}
      </dl>
    </header>
    ${notices.join('<div style="height:10px"></div>')}
    ${sections.map((s) => `<section class="s"><h2>${esc(s.heading)}</h2><div class="prose">${md.render(s.body)}</div></section>`).join("")}
    <section class="price" aria-labelledby="inv-h">
      <h2 id="inv-h">Investment</h2>
      <p class="sub">All prices in ${esc(p.currency)}.</p>
      <table class="items">
        <thead><tr><th>Item</th><th class="num hide-sm">Qty</th><th class="num hide-sm">Unit price</th><th class="num">Amount</th></tr></thead>
        <tbody>${reqRows}</tbody>
      </table>
      ${
        optional.length
          ? `<div class="opt-h">Optional add-ons</div><p class="sub" style="margin:0">${interactive ? "Tick any extras you'd like. The total updates as you go." : p.status === "ACCEPTED" ? "Add-ons chosen when the proposal was accepted." : "Extras that were available with this proposal."}</p>${optRows}`
          : ""
      }
      <div class="totals" aria-live="polite">
        <div class="r"><span>Subtotal</span><span>${m(totals.base)}</span></div>
        ${optional.length ? `<div class="r"><span>Add-ons</span><span id="t-addons">${addOnsShown ? "+ " + m(addOnsShown) : m(0)}</span></div>` : ""}
        <div class="r grand"><span>Total</span><span id="t-total">${m(totalShown)}</span></div>
      </div>
    </section>
    ${
      interactive
        ? `<div class="actions"><button class="btn btn-g" type="button" id="decline">Decline</button><button class="btn btn-p" type="button" id="accept">${ICON.check} Accept proposal</button></div>`
        : `<div style="height:40px"></div>`
    }
  </main>

  <main class="paper" id="done" hidden>
    <div class="band"></div>
    <div class="done">
      <div class="ic" id="done-ic"></div>
      <h2 id="done-h"></h2>
      <p id="done-p"></p>
      <div class="sum" id="done-sum"></div>
      <div class="btns"><button class="btn btn-s" type="button" id="done-view">View proposal</button><button class="btn btn-p" type="button" id="done-print">${ICON.print} Save a copy (PDF)</button></div>
    </div>
  </main>
  ${footer()}
</div>

<dialog id="dlg-accept" aria-labelledby="acc-h">
  <form class="dlg" id="f-accept" novalidate>
    <h3 id="acc-h">Accept this proposal</h3>
    <p>Type your full name to accept “${esc(p.title)}” from ${esc(from)}.</p>
    <div class="sum"><div class="r"><span>Add-ons</span><b id="acc-addons"></b></div><div class="r"><span>Total</span><b id="acc-total"></b></div></div>
    <label class="f" for="acc-name">Full name</label>
    <input type="text" id="acc-name" autocomplete="name" maxlength="120" required>
    <label class="agree"><input type="checkbox" id="acc-agree"> <span>I agree to the scope, terms and total in this proposal.</span></label>
    <div class="err" id="acc-err" role="alert"></div>
    <div class="row"><button class="btn btn-s" type="button" data-close>Cancel</button><button class="btn btn-p" type="submit" id="acc-submit" disabled>Accept proposal</button></div>
  </form>
</dialog>

<dialog id="dlg-decline" aria-labelledby="dec-h">
  <form class="dlg" id="f-decline" novalidate>
    <h3 id="dec-h">Decline this proposal?</h3>
    <p>${esc(from)} will be notified. If you'd like, tell them why. It helps them improve.</p>
    <label class="f" for="dec-reason">Reason (optional)</label>
    <textarea id="dec-reason" maxlength="1000" placeholder="e.g. Over our budget for this quarter"></textarea>
    <div class="err" id="dec-err" role="alert"></div>
    <div class="row"><button class="btn btn-s" type="button" data-close>Cancel</button><button class="btn btn-d" type="submit" id="dec-submit">Decline proposal</button></div>
  </form>
</dialog>

<script type="application/json" id="cw-data">${JSON.stringify({
    slug: p.slug,
    currency: p.currency,
    digits,
    locale: p.currency === "INR" ? "en-IN" : "en-US",
    base: totals.base,
    from,
    title: p.title,
    trackView: !opts.isOwner,
    interactive,
    optional: Object.fromEntries(optional.map((it) => [it.id, { name: it.name, total: lineTotal(it) }])),
  }).replace(/</g, "\\u003c")}</script>`;

  return layout(`${p.title} · Proposal for ${p.clientName}`, body, opts.nonce, CLIENT_JS);
}

// Runs in the client's browser. Plain ES2017, no dependencies.
const CLIENT_JS = `(function(){
  var D = JSON.parse(document.getElementById("cw-data").textContent);
  var $ = function(id){ return document.getElementById(id); };
  var fmt = function(minor){
    try { return new Intl.NumberFormat(D.locale,{style:"currency",currency:D.currency,minimumFractionDigits:D.digits,maximumFractionDigits:D.digits}).format(minor/Math.pow(10,D.digits)); }
    catch(e){ return D.currency+" "+(minor/Math.pow(10,D.digits)).toFixed(D.digits); }
  };
  var boxes = Array.prototype.slice.call(document.querySelectorAll('input[name="addon"]'));
  function selected(){ return boxes.filter(function(b){ return b.checked; }).map(function(b){ return b.value; }); }
  function addOns(){ return selected().reduce(function(s,id){ return s + (D.optional[id] ? D.optional[id].total : 0); }, 0); }
  function recalc(){
    var a = addOns();
    if ($("t-addons")) $("t-addons").textContent = a ? "+ " + fmt(a) : fmt(0);
    $("t-total").textContent = fmt(D.base + a);
    boxes.forEach(function(b){ b.closest(".opt").classList.toggle("on", b.checked); });
  }
  if (D.interactive) boxes.forEach(function(b){ b.addEventListener("change", recalc); });

  // Record one view per browser visit (tab session). Bots that only fetch HTML don't run this.
  if (D.trackView) {
    var key = "cw_viewed_" + D.slug, seen = false;
    try { seen = sessionStorage.getItem(key) === "1"; } catch(e){}
    if (!seen) {
      fetch("/p/" + D.slug + "/view", { method: "POST", keepalive: true }).catch(function(){});
      try { sessionStorage.setItem(key, "1"); } catch(e){}
    }
  }

  function post(path, body){
    return fetch("/p/" + D.slug + "/" + path, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(body) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ if(!r.ok) throw new Error(d.error || "Something went wrong. Please try again."); return d; }); });
  }
  function closeOn(dlg){ dlg.querySelectorAll("[data-close]").forEach(function(b){ b.addEventListener("click", function(){ dlg.close(); }); }); }
  function showErr(el, msg){ el.textContent = msg; el.style.display = msg ? "block" : "none"; }
  function busy(btn, on, label){ btn.disabled = on; if (label) btn.textContent = label; }

  function done(kind, info){
    $("proposal").hidden = true; $("done").hidden = false;
    var ok = kind === "accepted";
    $("done-ic").style.background = ok ? "var(--ok-l)" : "var(--line2)";
    $("done-ic").style.color = ok ? "var(--ok)" : "var(--muted)";
    $("done-ic").innerHTML = ok
      ? '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    $("done-h").textContent = ok ? "Thank you, " + info.firstName + "!" : "Proposal declined";
    $("done-p").textContent = ok
      ? "You've accepted the proposal. " + D.from + " has been notified and will be in touch about next steps."
      : "Thanks for letting " + D.from + " know. You can close this page.";
    var sum = $("done-sum");
    sum.innerHTML = "";
    if (ok) {
      var rows = [["Proposal", D.title], ["Accepted by", info.name], ["Add-ons", info.addOnNames.length ? info.addOnNames.join(", ") : "None"], ["Total", fmt(info.total)]];
      rows.forEach(function(r){ var d = document.createElement("div"); d.className = "r"; var a = document.createElement("span"); a.textContent = r[0]; var b = document.createElement("b"); b.textContent = r[1]; d.appendChild(a); d.appendChild(b); sum.appendChild(d); });
    }
    sum.hidden = !ok; $("done-print").hidden = !ok;
    // The proposal underneath now reflects the final state.
    boxes.forEach(function(b){ b.disabled = true; b.closest(".opt").classList.add("ro"); });
    var act = document.querySelector(".actions"); if (act) act.remove();
    window.scrollTo(0, 0);
  }
  $("done-view").addEventListener("click", function(){ $("done").hidden = true; $("proposal").hidden = false; });
  $("done-print").addEventListener("click", function(){ $("done").hidden = true; $("proposal").hidden = false; window.print(); });
  $("print").addEventListener("click", function(){ window.print(); });

  if (!D.interactive) return;

  // Accept
  var dA = $("dlg-accept"), name = $("acc-name"), agree = $("acc-agree"), sub = $("acc-submit"), errA = $("acc-err");
  closeOn(dA);
  function canAccept(){ sub.disabled = !(name.value.trim().length >= 2 && agree.checked); }
  name.addEventListener("input", canAccept); agree.addEventListener("change", canAccept);
  $("accept").addEventListener("click", function(){
    var a = addOns();
    $("acc-addons").textContent = a ? "+ " + fmt(a) : "None";
    $("acc-total").textContent = fmt(D.base + a);
    showErr(errA, ""); canAccept(); dA.showModal(); name.focus();
  });
  $("f-accept").addEventListener("submit", function(e){
    e.preventDefault(); if (sub.disabled) return;
    var ids = selected();
    busy(sub, true, "Accepting…"); showErr(errA, "");
    post("accept", { name: name.value.trim(), agree: agree.checked, selectedOptionalIds: ids })
      .then(function(d){
        dA.close();
        done("accepted", { name: d.acceptedBy, firstName: d.acceptedBy.split(/\\s+/)[0], total: d.total, addOnNames: ids.map(function(id){ return D.optional[id].name; }) });
      })
      .catch(function(err){ showErr(errA, err.message); busy(sub, false, "Accept proposal"); });
  });

  // Decline
  var dD = $("dlg-decline"), dsub = $("dec-submit"), errD = $("dec-err");
  closeOn(dD);
  $("decline").addEventListener("click", function(){ showErr(errD, ""); dD.showModal(); });
  $("f-decline").addEventListener("submit", function(e){
    e.preventDefault();
    busy(dsub, true, "Declining…"); showErr(errD, "");
    post("decline", { reason: $("dec-reason").value.trim(), selectedOptionalIds: selected() })
      .then(function(){ dD.close(); done("declined", {}); })
      .catch(function(err){ showErr(errD, err.message); busy(dsub, false, "Decline proposal"); });
  });
})();`;

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
