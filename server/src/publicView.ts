import MarkdownIt from "markdown-it";
import type { LineItem, Proposal, User } from "@prisma/client";
import { env } from "./env";
import { asSections, computeTotals, currencyDigits, formatMoney, isProposalExpired, lineTotal } from "./proposals";

// Presentation for the client-facing proposal page (/p/:slug). Routes + logic live in publicPage.ts.

export type PublicProposal = Proposal & { lineItems: LineItem[]; user: Pick<User, "id" | "name"> };

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

export const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** Same rule everywhere (dashboard, editor, MCP): valid through the whole validUntil day, then expired. */
export const isExpired = (p: Proposal) => isProposalExpired(p);

const initial = (name: string) => (name.trim().match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();

// ---------------------------------------------------------------------------
// Brand + icons
// ---------------------------------------------------------------------------

/** Closewise mark: a check whose long arm flows into a rounded "C". Same path as web/public/favicon.svg. */
const MARK = (size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="cwg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#4338CA"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#cwg)"/><path transform="translate(4 4)" d="M8.25 12.4 11.4 15.55 19.1 7.35A8.5 8.5 0 1 0 18.7 17.23" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const I = {
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  alert: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`,
  clock: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  eye: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  print: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>`,
  x: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  sig: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 19H4M5 15c2-4 3.5-9 5-9s-1 9 1 9 3-5 4.5-5S16 14 19 14"/></svg>`,
};

/** Animated success check (circle draws, then the tick). */
const BIG_CHECK = `<svg class="chk" viewBox="0 0 56 56" aria-hidden="true"><circle class="chk-c" cx="28" cy="28" r="25"/><path class="chk-k" d="M17 29.5l7.5 7.5L40 21.5"/></svg>`;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">`;

const CSS = `
:root{
  --ink:#0B0B0F;--ink2:#3F3F46;--muted:#71717A;--faint:#A1A1AA;
  --line:#E4E4E7;--line2:#F1F1F3;--bg:#F6F6F7;--card:#fff;
  --accent:#4F46E5;--accent-d:#4338CA;--accent-50:#EEF2FF;--accent-100:#E0E7FF;--accent-200:#C7D2FE;
  --ok:#10B981;--ok-d:#047857;--ok-50:#ECFDF5;--ok-200:#A7F3D0;
  --bad:#E11D48;--bad-50:#FFF1F2;--warn-d:#B45309;--warn-50:#FFFBEB;
  --r:16px;--ease:cubic-bezier(.2,.8,.2,1);
  --shadow:0 1px 2px rgba(11,11,15,.04),0 12px 40px -16px rgba(11,11,15,.14);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 Geist,Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"ss01","cv11"}
a{color:var(--accent);text-underline-offset:3px}
button{font-family:inherit}
/* Never let long words/URLs widen the page on phones */
h1,h2,.prose,.nm,.ds,.facts dd,.biz .n,.sig .name,.done .card b{overflow-wrap:anywhere}
.row>div,.opt>span,.biz>div,.sig>div{min-width:0}
.money{font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.wrap{max-width:860px;margin:0 auto;padding:28px 16px 40px}
@media (max-width:720px){.wrap{padding:12px 12px 32px}.wrap.has-bar{padding-bottom:120px}}

/* Top utility row */
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 4px 14px;font-size:13px;color:var(--muted)}
.top .from{display:flex;align-items:center;gap:8px;min-width:0}
.top .from b{color:var(--ink);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Paper */
.paper{background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);overflow:hidden;animation:rise .35s var(--ease) both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.pad{padding:44px 56px}
@media (max-width:720px){.pad{padding:28px 22px}}

/* Header */
.head{position:relative;background:linear-gradient(180deg,#FBFBFD,#fff);border-bottom:1px solid var(--line2)}
.head::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--accent),#818CF8 60%,transparent)}
.biz{display:flex;align-items:center;gap:12px}
.ava{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--accent);color:#fff;font-weight:600;font-size:17px;letter-spacing:-.02em;box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 1px 2px rgba(79,70,229,.35);flex:none}
.biz .n{font-weight:600;letter-spacing:-.01em;line-height:1.25}
.biz .s{font-size:13px;color:var(--muted);line-height:1.3}
.kind{margin-left:auto;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:4px 10px;background:#fff}
h1{font-size:40px;line-height:1.1;letter-spacing:-.035em;margin:36px 0 0;font-weight:650;text-wrap:balance}
@media (max-width:720px){h1{font-size:28px;margin-top:28px}}
.facts{display:flex;flex-wrap:wrap;gap:10px 28px;margin-top:22px;font-size:14px}
.facts div{display:flex;flex-direction:column}
.facts dt{font-size:12px;color:var(--muted);margin:0}
.facts dd{margin:1px 0 0;font-weight:550;color:var(--ink)}

/* Notices */
.notes{padding:20px 56px 0;display:grid;gap:10px}
@media (max-width:720px){.notes{padding:18px 22px 0}}
.note{display:flex;gap:10px;align-items:flex-start;border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.5;border:1px solid}
.note svg{flex:none;margin-top:2px}
.n-ok{background:var(--ok-50);border-color:var(--ok-200);color:var(--ok-d)}
.n-bad{background:var(--bad-50);border-color:#FECDD3;color:#9F1239}
.n-warn{background:var(--warn-50);border-color:#FDE68A;color:#92400E}
.n-info{background:var(--accent-50);border-color:var(--accent-100);color:#3730A3}

/* Sections */
.body{padding:12px 56px 8px}
@media (max-width:720px){.body{padding:8px 22px 4px}}
.sec{display:grid;grid-template-columns:120px 1fr;gap:24px;padding:28px 0;border-bottom:1px solid var(--line2)}
.sec:last-child{border-bottom:0}
@media (max-width:720px){.sec{grid-template-columns:1fr;gap:6px;padding:22px 0}}
.sec .no{font-size:12px;font-weight:600;color:var(--accent);letter-spacing:.06em;padding-top:5px;font-variant-numeric:tabular-nums}
.sec h2{font-size:20px;line-height:1.3;letter-spacing:-.02em;margin:0 0 10px;font-weight:600}
.prose{color:var(--ink2);font-size:15.5px;line-height:1.7}
.prose p{margin:0 0 12px}.prose ul,.prose ol{margin:0 0 12px;padding-left:20px}.prose li{margin:4px 0;padding-left:2px}
.prose li::marker{color:var(--faint)}.prose ol li::marker{color:var(--muted);font-variant-numeric:tabular-nums}
.prose strong{color:var(--ink);font-weight:600}
.prose h1,.prose h2,.prose h3,.prose h4{font-size:15.5px;color:var(--ink);margin:18px 0 6px;letter-spacing:-.01em}
.prose blockquote{margin:0 0 12px;padding:2px 0 2px 16px;border-left:2px solid var(--accent-200);color:var(--muted)}
.prose code{background:var(--line2);border-radius:5px;padding:1px 6px;font-size:13.5px}
.prose table{border-collapse:collapse;margin:0 0 12px;font-size:14px;display:block;overflow-x:auto;max-width:100%}
.prose th,.prose td{border:1px solid var(--line);padding:7px 10px;text-align:left}
.prose hr{border:0;border-top:1px solid var(--line);margin:18px 0}
.prose>:last-child{margin-bottom:0}

/* Pricing */
.price{margin:8px 24px 0;background:#FAFAFB;border:1px solid var(--line2);border-radius:var(--r);padding:32px 32px 28px}
@media (max-width:720px){.price{margin:8px 10px 0;padding:22px 14px 18px}}
.price-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 14px}
.price-h h2{font-size:20px;letter-spacing:-.02em;margin:0;font-weight:600}
.price-h span{font-size:12px;color:var(--muted)}
.rows{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.row{display:grid;grid-template-columns:1fr auto;gap:16px;padding:16px 18px;border-top:1px solid var(--line2);align-items:start}
.row:first-child{border-top:0}
.row .nm{font-weight:550;letter-spacing:-.01em}
.row .ds{color:var(--muted);font-size:13.5px;margin-top:2px;line-height:1.5}
.row .qx{color:var(--faint);font-size:12.5px;margin-top:3px}
.row .amt{font-weight:550;white-space:nowrap;text-align:right}
.opt-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:26px 2px 10px}
.opt-h b{font-size:15px;font-weight:600;letter-spacing:-.01em}
.opt-h span{font-size:13px;color:var(--muted)}
.opts{display:grid;gap:8px}
.opt{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:start;padding:15px 18px;background:#fff;border:1px solid var(--line);border-radius:14px;cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s}
.opt:hover{border-color:var(--accent-200)}
.opt.on{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-50)}
.opt.ro{cursor:default}.opt.ro:hover{border-color:var(--line)}.opt.ro.on{box-shadow:none}
.opt input{appearance:none;-webkit-appearance:none;width:20px;height:20px;margin:1px 0 0;border:1.5px solid #D4D4D8;border-radius:6px;background:#fff;display:grid;place-content:center;cursor:inherit;transition:background .15s,border-color .15s}
.opt input::after{content:"";width:10px;height:6px;border:2px solid #fff;border-top:0;border-right:0;transform:rotate(-45deg) translate(1px,-1px) scale(.4);opacity:0;transition:transform .15s var(--ease),opacity .15s}
.opt input:checked{background:var(--accent);border-color:var(--accent)}
.opt input:checked::after{opacity:1;transform:rotate(-45deg) translate(1px,-1px) scale(1)}
.opt input:focus-visible{outline:3px solid var(--accent-200);outline-offset:2px}
.opt .amt{font-weight:550;white-space:nowrap}
.opt .amt small{color:var(--muted);font-weight:500}
.tot{margin:22px 2px 0 auto;max-width:340px;font-size:14px}
.tot .r{display:flex;justify-content:space-between;gap:12px;padding:4px 0;color:var(--ink2)}
.tot .grand{border-top:1px solid var(--line);margin-top:10px;padding-top:14px;align-items:baseline;color:var(--ink)}
.tot .grand span:first-child{font-weight:600;font-size:15px}
.tot .grand .v{font-size:30px;font-weight:650;letter-spacing:-.03em;line-height:1}
.v.bump{animation:bump .45s var(--ease)}
@keyframes bump{0%{color:var(--accent)}100%{color:var(--ink)}}

/* Acceptance block (also printed) */
.sig{margin:24px 24px 0;border:1px solid var(--ok-200);background:var(--ok-50);border-radius:var(--r);padding:20px 24px;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center}
@media (max-width:720px){.sig{margin:16px 10px 0;grid-template-columns:auto 1fr;padding:16px}}
.sig .ic{width:36px;height:36px;border-radius:50%;background:var(--ok);color:#fff;display:grid;place-items:center}
.sig .t{font-weight:600;color:var(--ok-d);letter-spacing:-.01em}
.sig .d{font-size:13px;color:#065F46;opacity:.85}
.sig .name{font-size:22px;font-style:italic;font-weight:500;color:var(--ink);letter-spacing:-.01em;border-bottom:1px solid var(--ok-200);padding:0 4px 2px}
@media (max-width:720px){.sig .name{grid-column:1/-1;justify-self:start}}

/* Actions */
.actions{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:28px 56px 40px}
@media (max-width:720px){.actions{display:none}}
.actions .hint{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px}
.actions .btns{display:flex;gap:10px}
.btn{appearance:none;border:0;border-radius:12px;font:600 15px/1 Geist,Inter,system-ui,sans-serif;letter-spacing:-.01em;padding:0 20px;height:46px;cursor:pointer;transition:background .15s,box-shadow .15s,transform .15s,opacity .15s;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;white-space:nowrap}
.btn:active{transform:scale(.98)}
.btn:focus-visible{outline:3px solid var(--accent-200);outline-offset:2px}
.btn-p{background:var(--accent);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 1px 2px rgba(79,70,229,.35),0 6px 16px -6px rgba(79,70,229,.5)}.btn-p:hover{background:var(--accent-d)}
.btn-s{background:#fff;color:var(--ink2);border:1px solid var(--line);box-shadow:0 1px 1px rgba(11,11,15,.04)}.btn-s:hover{background:#FAFAFA;border-color:#D4D4D8}
.btn-g{background:transparent;color:var(--muted)}.btn-g:hover{color:var(--ink);background:var(--line2)}
.btn-d{background:var(--bad);color:#fff}.btn-d:hover{background:#BE123C}
.btn-sm{height:34px;padding:0 12px;font-size:13px;border-radius:10px;font-weight:500}
.btn[disabled]{opacity:.45;cursor:not-allowed;transform:none}

/* Mobile sticky bar */
.mbar{display:none}
@media (max-width:720px){
  .mbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:20;align-items:center;gap:12px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgba(255,255,255,.92);backdrop-filter:saturate(1.6) blur(16px);-webkit-backdrop-filter:saturate(1.6) blur(16px);border-top:1px solid var(--line);box-shadow:0 -8px 24px -12px rgba(11,11,15,.12)}
  .mbar .l{flex:1;min-width:0;line-height:1.2}
  .mbar .l span{display:block;font-size:12px;color:var(--muted)}
  .mbar .l b{font-size:20px;font-weight:650;letter-spacing:-.03em}
  .mbar .more{flex:none}
}

/* Footer */
.foot{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:28px;font-size:13px;color:var(--faint)}
.foot a{display:inline-flex;align-items:center;gap:6px;color:var(--ink2);font-weight:600;text-decoration:none;letter-spacing:-.01em;transition:color .15s}
.foot a:hover{color:var(--accent)}

/* Dialogs */
dialog{border:0;border-radius:20px;padding:0;width:min(460px,calc(100vw - 24px));box-shadow:0 4px 12px -2px rgba(11,11,15,.08),0 32px 64px -16px rgba(11,11,15,.28);color:var(--ink)}
dialog[open]{animation:pop .18s var(--ease)}
@keyframes pop{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
dialog::backdrop{background:rgba(11,11,15,.4);backdrop-filter:blur(3px)}
@media (max-width:720px){dialog{margin:auto auto 12px;max-height:calc(100dvh - 24px)}}
.dlg{padding:28px}
.dlg h3{margin:0;font-size:19px;letter-spacing:-.02em;font-weight:600}
.dlg p{margin:6px 0 0;color:var(--muted);font-size:14px}
.dlg .sum{margin-top:20px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:14px;background:#FAFAFB}
.dlg .sum .r{display:flex;justify-content:space-between;gap:12px}.dlg .sum .r+.r{margin-top:6px}
.dlg .sum .r span{color:var(--muted)}
.dlg .sum .grand b{font-size:17px;letter-spacing:-.02em}
.dlg label.f{display:block;font-size:13px;font-weight:500;color:var(--ink2);margin-top:20px}
.dlg input[type=text],.dlg textarea{display:block;width:100%;margin-top:6px;border:1px solid var(--line);border-radius:10px;padding:0 12px;height:44px;font:16px Geist,Inter,system-ui,sans-serif;color:var(--ink);background:#fff;transition:border-color .15s,box-shadow .15s}
.dlg textarea{height:auto;min-height:92px;padding:10px 12px;resize:vertical}
.dlg input[type=text]:focus,.dlg textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px var(--accent-50)}
.dlg .typed{margin-top:8px;min-height:30px;font-size:22px;font-style:italic;color:var(--ink);letter-spacing:-.01em;border-bottom:1px dashed var(--line);padding-bottom:4px}
.agree{display:flex;gap:10px;align-items:flex-start;margin-top:16px;font-size:14px;color:var(--ink2);cursor:pointer;line-height:1.45}
.agree input{width:18px;height:18px;margin:1px 0 0;accent-color:var(--accent);flex:none}
.dlg .err{display:none;margin-top:14px;background:var(--bad-50);border:1px solid #FECDD3;color:#9F1239;border-radius:10px;padding:10px 12px;font-size:14px}
.dlg .row2{display:flex;gap:10px;justify-content:flex-end;margin-top:24px}
@media (max-width:720px){.dlg{padding:22px}.dlg .row2 .btn{flex:1}}

/* Success */
.done{text-align:center;padding:64px 28px 56px}
.chk{width:76px;height:76px;display:block;margin:0 auto}
.chk-c{fill:none;stroke:var(--ok);stroke-width:2.5;stroke-dasharray:158;stroke-dashoffset:158;animation:draw .6s var(--ease) forwards}
.chk-k{fill:none;stroke:var(--ok);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:36;stroke-dashoffset:36;animation:draw .35s .45s var(--ease) forwards}
.chk-wrap{width:96px;height:96px;margin:0 auto;border-radius:50%;background:var(--ok-50);display:grid;place-items:center;animation:pulse .9s .2s var(--ease) both}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes pulse{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}
.done h2{font-size:30px;letter-spacing:-.035em;margin:26px 0 0;font-weight:650}
.done p{color:var(--muted);margin:10px auto 0;max-width:440px;font-size:15px}
.done .card{max-width:400px;margin:30px auto 0;text-align:left;border:1px solid var(--line);border-radius:16px;overflow:hidden}
.done .card .r{display:flex;justify-content:space-between;gap:16px;padding:12px 16px;font-size:14px;border-top:1px solid var(--line2)}
.done .card .r:first-child{border-top:0}
.done .card .r span{color:var(--muted)}
.done .card .r b{text-align:right;font-weight:550}
.done .card .signed b{font-style:italic;font-size:16px}
.done .card .grand b{font-size:18px;letter-spacing:-.02em}
.done .btns{margin-top:28px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.done.bad .xic{width:72px;height:72px;margin:0 auto;border-radius:50%;background:var(--line2);color:var(--muted);display:grid;place-items:center}

[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;transition-duration:.01ms!important}.chk-c,.chk-k{stroke-dashoffset:0}}

/* Print → clean PDF */
@media print{
  @page{margin:16mm 14mm}
  body{background:#fff;font-size:11.5pt;line-height:1.55}
  .wrap{max-width:none;padding:0}
  .top,.actions,.mbar,dialog,.n-info,.no-print,#done{display:none!important}
  #proposal{display:block!important}
  .paper{border:0;box-shadow:none;border-radius:0;animation:none}
  .head{background:none}.head::before{display:none}
  .pad,.body,.notes{padding-left:0;padding-right:0}
  .pad{padding-top:0}
  h1{font-size:26pt}
  .price{margin:12px 0 0;background:none;border:0;padding:12px 0 0}
  .rows,.opt{border-color:#D4D4D8}
  .opt{box-shadow:none!important;break-inside:avoid}
  .opt:not(.on){opacity:.65}
  .opt input,.ava,.sig .ic{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sec,.row,.tot,.sig{break-inside:avoid}
  .sig{margin:16px 0 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  a{color:inherit;text-decoration:none}
  .foot{margin-top:24px}
}`;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function layout(title: string, body: string, nonce: string, script = "") {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#F6F6F7">
<title>${esc(title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
${FONT}<style nonce="${nonce}">${CSS}</style>
</head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

const footer = () =>
  `<footer class="foot"><span>Made with</span><a href="${esc(env.APP_URL)}/" target="_blank" rel="noopener">${MARK(18)}Closewise</a></footer>`;

export function notFoundPage(nonce: string) {
  return layout(
    "Proposal not found",
    `<div class="wrap"><main class="paper"><div class="done bad">
      <div class="xic">${I.alert.replace(/width="16" height="16"/, 'width="28" height="28"')}</div>
      <h2>Proposal not found</h2>
      <p>This link may be mistyped, or the proposal hasn't been shared yet. Ask the sender for an up-to-date link.</p>
    </div></main>${footer()}</div>`,
    nonce
  );
}

function acceptanceBlock(name: string, date: Date) {
  return `<section class="sig" aria-label="Acceptance">
    <span class="ic">${I.check}</span>
    <div><div class="t">Accepted</div><div class="d">Signed electronically on ${fmtDate(date)}</div></div>
    <span class="name">${esc(name)}</span>
  </section>`;
}

export function renderPage(p: PublicProposal, opts: { isOwner: boolean; nonce: string }) {
  const digits = currencyDigits(p.currency);
  const m = (minor: number) => formatMoney(minor, p.currency);
  const items = [...p.lineItems].sort((a, b) => a.position - b.position);
  const required = items.filter((i) => !i.optional);
  const optional = items.filter((i) => i.optional);
  const totals = computeTotals(items, p.selectedOptionalIds);
  const selected = new Set(Array.isArray(p.selectedOptionalIds) ? p.selectedOptionalIds.map(String) : []);
  const accepted = p.status === "ACCEPTED";
  const decided = accepted || p.status === "DECLINED";
  const expired = !decided && isExpired(p);
  const interactive = !decided && !expired;
  const sections = asSections(p.sections);
  const from = p.user.name;

  const notes: string[] = [];
  if (p.status === "DECLINED") notes.push(`<div class="note n-bad">${I.x}<span>This proposal was declined.</span></div>`);
  if (expired && p.validUntil)
    notes.push(
      `<div class="note n-warn">${I.clock}<span>This proposal expired on ${fmtDate(p.validUntil)}. Contact ${esc(from)} for an updated quote.</span></div>`
    );
  if (opts.isOwner)
    notes.push(`<div class="note n-info">${I.eye}<span>You're viewing your own proposal. Your visits aren't recorded as client views.</span></div>`);

  const qtyLine = (it: LineItem) => (it.quantity !== 1 ? `<div class="qx money">${fmtQty(it.quantity)} × ${m(it.unitPrice)}</div>` : "");

  const reqRows = required
    .map(
      (it) => `<div class="row">
        <div><div class="nm">${esc(it.name)}</div>${it.description ? `<div class="ds">${esc(it.description)}</div>` : ""}${qtyLine(it)}</div>
        <div class="amt money">${m(lineTotal(it))}</div>
      </div>`
    )
    .join("");

  const optRows = optional
    .map((it) => {
      const on = selected.has(it.id);
      return `<label class="opt${on ? " on" : ""}${interactive ? "" : " ro"}">
        <input type="checkbox" name="addon" value="${esc(it.id)}"${on ? " checked" : ""}${interactive ? "" : " disabled"} aria-label="Add ${esc(it.name)}">
        <span><span class="nm" style="display:block;font-weight:550;letter-spacing:-.01em">${esc(it.name)}</span>${it.description ? `<span class="ds" style="display:block;color:var(--muted);font-size:13.5px;margin-top:2px;line-height:1.5">${esc(it.description)}</span>` : ""}${it.quantity !== 1 ? `<span class="qx money" style="display:block;color:var(--faint);font-size:12.5px;margin-top:3px">${fmtQty(it.quantity)} × ${m(it.unitPrice)}</span>` : ""}</span>
        <span class="amt money"><small>+</small> ${m(lineTotal(it))}</span>
      </label>`;
    })
    .join("");

  const addOnsShown = accepted ? totals.optionalSelected : 0;
  const totalShown = accepted ? totals.total : totals.base;

  const body = `<div class="wrap${interactive ? " has-bar" : ""}">
  <div class="top no-print">
    <span class="from"><span>Proposal from</span> <b>${esc(from)}</b></span>
    <button class="btn btn-g btn-sm" type="button" id="print">${I.print} Download / Print</button>
  </div>

  <main class="paper" id="proposal">
    <header class="head pad">
      <div class="biz">
        <span class="ava" aria-hidden="true">${esc(initial(from))}</span>
        <div><div class="n">${esc(from)}</div><div class="s">${fmtDate(p.createdAt)}</div></div>
        <span class="kind">Proposal</span>
      </div>
      <h1>${esc(p.title)}</h1>
      <dl class="facts">
        <div><dt>Prepared for</dt><dd>${esc(p.clientName)}</dd></div>
        ${p.validUntil ? `<div><dt>Valid until</dt><dd>${fmtDate(p.validUntil)}</dd></div>` : ""}
        <div><dt>${accepted ? "Accepted total" : "Total"}</dt><dd class="money">${m(totalShown)}</dd></div>
      </dl>
    </header>

    ${notes.length ? `<div class="notes">${notes.join("")}</div>` : ""}

    ${
      sections.length
        ? `<div class="body">${sections
            .map(
              (s, i) =>
                `<section class="sec"><div class="no">${String(i + 1).padStart(2, "0")}</div><div><h2>${esc(s.heading)}</h2><div class="prose">${md.render(s.body)}</div></div></section>`
            )
            .join("")}</div>`
        : ""
    }

    <section class="price" aria-labelledby="inv-h">
      <div class="price-h"><h2 id="inv-h">Investment</h2><span>All prices in ${esc(p.currency)}</span></div>
      <div class="rows">${reqRows}</div>
      ${
        optional.length
          ? `<div class="opt-h"><b>Optional add-ons</b><span>${interactive ? "Select any extras. Your total updates instantly." : accepted ? "Chosen at acceptance" : "Available with this proposal"}</span></div><div class="opts">${optRows}</div>`
          : ""
      }
      <div class="tot" aria-live="polite">
        <div class="r"><span>Subtotal</span><span class="money">${m(totals.base)}</span></div>
        ${optional.length ? `<div class="r"><span>Add-ons</span><span class="money" id="t-addons">${addOnsShown ? "+ " + m(addOnsShown) : m(0)}</span></div>` : ""}
        <div class="r grand"><span>Total</span><span class="v money" id="t-total">${m(totalShown)}</span></div>
      </div>
    </section>

    <div id="sig-slot">${accepted && p.acceptedBy ? acceptanceBlock(p.acceptedBy, p.acceptedAt ?? p.updatedAt) : ""}</div>

    ${
      interactive
        ? `<div class="actions">
            <span class="hint">${I.sig} Accept online. It takes a few seconds.</span>
            <div class="btns"><button class="btn btn-s" type="button" id="decline">Decline</button><button class="btn btn-p" type="button" id="accept">${I.check} Accept proposal</button></div>
          </div>`
        : `<div style="height:44px"></div>`
    }
  </main>

  <main class="paper" id="done" hidden aria-live="polite"></main>

  ${footer()}
</div>

${
  interactive
    ? `<div class="mbar" id="mbar">
        <div class="l"><span>Total</span><b class="money" id="m-total">${m(totalShown)}</b></div>
        <button class="btn btn-g more" type="button" id="m-decline" aria-label="Decline proposal">Decline</button>
        <button class="btn btn-p" type="button" id="m-accept">${I.check} Accept</button>
      </div>`
    : ""
}

<dialog id="dlg-accept" aria-labelledby="acc-h">
  <form class="dlg" id="f-accept" novalidate>
    <h3 id="acc-h">Accept proposal</h3>
    <p>“${esc(p.title)}” from ${esc(from)}</p>
    <div class="sum"><div class="r"><span>Add-ons</span><b class="money" id="acc-addons"></b></div><div class="r grand"><span>Total</span><b class="money" id="acc-total"></b></div></div>
    <label class="f" for="acc-name">Type your full name to sign</label>
    <input type="text" id="acc-name" autocomplete="name" maxlength="120" required placeholder="Your full name">
    <div class="typed" id="acc-typed" aria-hidden="true"></div>
    <label class="agree"><input type="checkbox" id="acc-agree"> <span>I agree to the scope, terms and total in this proposal.</span></label>
    <div class="err" id="acc-err" role="alert"></div>
    <div class="row2"><button class="btn btn-s" type="button" data-close>Cancel</button><button class="btn btn-p" type="submit" id="acc-submit" disabled>Accept &amp; sign</button></div>
  </form>
</dialog>

<dialog id="dlg-decline" aria-labelledby="dec-h">
  <form class="dlg" id="f-decline" novalidate>
    <h3 id="dec-h">Decline this proposal?</h3>
    <p>${esc(from)} will be notified. If you like, tell them why. It helps them improve.</p>
    <label class="f" for="dec-reason">Reason (optional)</label>
    <textarea id="dec-reason" maxlength="1000" placeholder="e.g. Over our budget for this quarter"></textarea>
    <div class="err" id="dec-err" role="alert"></div>
    <div class="row2"><button class="btn btn-s" type="button" data-close>Cancel</button><button class="btn btn-d" type="submit" id="dec-submit">Decline proposal</button></div>
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

// ---------------------------------------------------------------------------
// Browser script (plain ES2017, no dependencies)
// ---------------------------------------------------------------------------

const CLIENT_JS = `(function(){
  var D = JSON.parse(document.getElementById("cw-data").textContent);
  var $ = function(id){ return document.getElementById(id); };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fmt = function(minor){
    try { return new Intl.NumberFormat(D.locale,{style:"currency",currency:D.currency,minimumFractionDigits:D.digits,maximumFractionDigits:D.digits}).format(minor/Math.pow(10,D.digits)); }
    catch(e){ return D.currency+" "+(minor/Math.pow(10,D.digits)).toFixed(D.digits); }
  };
  var esc = function(s){ var d = document.createElement("div"); d.textContent = s; return d.innerHTML; };
  var boxes = Array.prototype.slice.call(document.querySelectorAll('input[name="addon"]'));
  function selected(){ return boxes.filter(function(b){ return b.checked; }).map(function(b){ return b.value; }); }
  function addOns(){ return selected().reduce(function(s,id){ return s + (D.optional[id] ? D.optional[id].total : 0); }, 0); }

  // Animated total: tween the number and flash the accent colour.
  var shown = D.base, raf = 0;
  function paint(v){ var t = fmt(Math.round(v)); $("t-total").textContent = t; if ($("m-total")) $("m-total").textContent = t; }
  function animateTo(to){
    cancelAnimationFrame(raf);
    var from = shown, start = 0, dur = reduce ? 0 : 420;
    var el = $("t-total"); el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    if (!dur) { shown = to; paint(to); return; }
    raf = requestAnimationFrame(function step(ts){
      if (!start) start = ts;
      var k = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - k, 3);
      shown = from + (to - from) * e; paint(shown);
      if (k < 1) raf = requestAnimationFrame(step); else { shown = to; paint(to); }
    });
  }
  function recalc(){
    var a = addOns();
    if ($("t-addons")) $("t-addons").textContent = a ? "+ " + fmt(a) : fmt(0);
    boxes.forEach(function(b){ b.closest(".opt").classList.toggle("on", b.checked); });
    animateTo(D.base + a);
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

  $("print").addEventListener("click", function(){ window.print(); });

  function post(path, body){
    return fetch("/p/" + D.slug + "/" + path, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(body) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ if(!r.ok) throw new Error(d.error || "Something went wrong. Please try again."); return d; }); });
  }
  function closeOn(dlg){ dlg.querySelectorAll("[data-close]").forEach(function(b){ b.addEventListener("click", function(){ dlg.close(); }); }); }
  function showErr(el, msg){ el.textContent = msg; el.style.display = msg ? "block" : "none"; }
  function busy(btn, on, label){ btn.disabled = on; if (label) btn.textContent = label; }
  function longDate(d){ return d.toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" }); }

  function finalize(){
    boxes.forEach(function(b){ b.disabled = true; b.closest(".opt").classList.add("ro"); });
    var act = document.querySelector(".actions"); if (act) act.outerHTML = '<div style="height:44px"></div>';
    var bar = $("mbar"); if (bar) bar.remove();
    document.querySelector(".wrap").classList.remove("has-bar");
  }
  function showDone(html){
    $("done").innerHTML = html; $("done").hidden = false; $("proposal").hidden = true;
    var v = $("done-view"); if (v) v.addEventListener("click", function(){ $("done").hidden = true; $("proposal").hidden = false; window.scrollTo(0,0); });
    var pr = $("done-print"); if (pr) pr.addEventListener("click", function(){ window.print(); });
    window.scrollTo(0, 0);
  }

  function accepted(info){
    finalize();
    var date = longDate(new Date(info.acceptedAt));
    // Acceptance block inside the document, so a printed PDF carries the signature.
    $("sig-slot").innerHTML = '<section class="sig" aria-label="Acceptance"><span class="ic">${I.check.replace(/"/g, '\\"')}</span><div><div class="t">Accepted</div><div class="d">Signed electronically on ' + esc(date) + '</div></div><span class="name">' + esc(info.name) + '</span></section>';
    showDone(
      '<div class="done">' +
        '<div class="chk-wrap">${BIG_CHECK.replace(/"/g, '\\"')}</div>' +
        '<h2>Proposal accepted</h2>' +
        '<p>Thank you, ' + esc(info.name.split(/\\s+/)[0]) + '. ' + esc(D.from) + ' has been notified and will be in touch about next steps.</p>' +
        '<div class="card">' +
          '<div class="r"><span>Proposal</span><b>' + esc(D.title) + '</b></div>' +
          '<div class="r signed"><span>Signed by</span><b>' + esc(info.name) + '</b></div>' +
          '<div class="r"><span>Date</span><b>' + esc(date) + '</b></div>' +
          '<div class="r"><span>Add-ons</span><b>' + esc(info.addOnNames.length ? info.addOnNames.join(", ") : "None") + '</b></div>' +
          '<div class="r grand"><span>Total</span><b class="money">' + esc(fmt(info.total)) + '</b></div>' +
        '</div>' +
        '<div class="btns"><button class="btn btn-s" type="button" id="done-view">View proposal</button><button class="btn btn-p" type="button" id="done-print">${I.print.replace(/"/g, '\\"')} Download / Print</button></div>' +
      '</div>'
    );
  }
  function declined(){
    finalize();
    showDone(
      '<div class="done bad"><div class="xic">${I.x.replace(/width="16" height="16"/, 'width="26" height="26"').replace(/"/g, '\\"')}</div>' +
      '<h2>Proposal declined</h2><p>Thanks for letting ' + esc(D.from) + ' know. You can close this page.</p>' +
      '<div class="btns"><button class="btn btn-s" type="button" id="done-view">View proposal</button></div></div>'
    );
  }

  if (!D.interactive) return;

  // Accept
  var dA = $("dlg-accept"), name = $("acc-name"), agree = $("acc-agree"), sub = $("acc-submit"), errA = $("acc-err"), typed = $("acc-typed");
  closeOn(dA);
  function canAccept(){ typed.textContent = name.value.trim(); sub.disabled = !(name.value.trim().length >= 2 && agree.checked); }
  name.addEventListener("input", canAccept); agree.addEventListener("change", canAccept);
  function openAccept(){
    var a = addOns();
    $("acc-addons").textContent = a ? "+ " + fmt(a) : "None";
    $("acc-total").textContent = fmt(D.base + a);
    showErr(errA, ""); canAccept(); dA.showModal(); name.focus();
  }
  $("accept").addEventListener("click", openAccept);
  if ($("m-accept")) $("m-accept").addEventListener("click", openAccept);
  $("f-accept").addEventListener("submit", function(e){
    e.preventDefault(); if (sub.disabled) return;
    var ids = selected();
    busy(sub, true, "Accepting…"); showErr(errA, "");
    post("accept", { name: name.value.trim(), agree: agree.checked, selectedOptionalIds: ids })
      .then(function(d){
        dA.close();
        accepted({ name: d.acceptedBy, acceptedAt: d.acceptedAt, total: d.total, addOnNames: ids.map(function(id){ return D.optional[id].name; }) });
      })
      .catch(function(err){ showErr(errA, err.message); busy(sub, false, "Accept & sign"); });
  });

  // Decline
  var dD = $("dlg-decline"), dsub = $("dec-submit"), errD = $("dec-err");
  closeOn(dD);
  function openDecline(){ showErr(errD, ""); dD.showModal(); }
  $("decline").addEventListener("click", openDecline);
  if ($("m-decline")) $("m-decline").addEventListener("click", openDecline);
  $("f-decline").addEventListener("submit", function(e){
    e.preventDefault();
    busy(dsub, true, "Declining…"); showErr(errD, "");
    post("decline", { reason: $("dec-reason").value.trim(), selectedOptionalIds: selected() })
      .then(function(){ dD.close(); declined(); })
      .catch(function(err){ showErr(errD, err.message); busy(dsub, false, "Decline proposal"); });
  });
})();`;
