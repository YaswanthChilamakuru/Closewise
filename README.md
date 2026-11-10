# Closewise

**Proposals written by your own Claude, sent and tracked from here.**

Closewise is a proposal and quote tool for freelancers and small agencies. You ask *your own* Claude
(claude.ai) to draft a proposal; Claude saves it into Closewise over MCP. Closewise stores it, computes
the totals, hosts a polished public page for your client, and tracks when they view, accept or decline it.

- **Editor:** sections in Markdown with a live preview, line items with optional add-ons, autosave
- **Client page** (`/p/:slug`, no login): add-on checkboxes with a live total, typed-name acceptance, decline with a reason, print-ready PDF
- **Dashboard:** open value, accepted this month and acceptance rate, refreshed every 10 seconds
- **Tracking:** an activity timeline of created, edited, published, viewed, accepted and declined events, with expiry handling
- **Claude via MCP:** create, list, read, update and publish proposals from a normal Claude chat

---

## Architecture

```
  ┌──────────────────────┐        ┌──────────────────────┐        ┌──────────────────────┐
  │  You, in claude.ai   │        │ You, in the browser  │        │  Your client's       │
  │  (your own Claude)   │        │  (dashboard/editor)  │        │  browser (no login)  │
  └──────────┬───────────┘        └──────────┬───────────┘        └──────────┬───────────┘
             │ MCP tool calls                │ HTTPS + JWT cookie            │ HTTPS
             │ POST /mcp/:token              │ /api/*  +  React SPA          │ GET /p/:slug
             ▼                               ▼                               ▼
  ┌────────────────────────────────────────────────────────────────────────────────────────┐
  │                  Closewise: one Node 20 / Express service (Render)                     │
  │                                                                                        │
  │   /mcp/:token     MCP server (stateless Streamable HTTP, zod-validated tools)          │
  │   /api/*          JSON API: auth (bcrypt + httpOnly JWT), proposals, stats            │
  │   /p/:slug        server-rendered client page: view / accept / decline                 │
  │   /health         liveness ("ok", no DB)                                               │
  │   /*              built React app (web/dist), SPA fallback                             │
  │                                                                                        │
  │   Money stored as integers (paise/cents); all totals computed on the server            │
  └──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             │ Prisma (pg driver adapter), TLS
                                             ▼
                              ┌──────────────────────────────┐
                              │   PostgreSQL on Neon         │
                              │   User · Proposal ·          │
                              │   LineItem · Activity        │
                              └──────────────────────────────┘
```

The writing happens in **your** Claude conversation. Closewise only receives structured data
(title, sections, line items) through MCP tool calls and stores it.

---

## No AI inside

Closewise contains **no AI**. It doesn't host a model, call an LLM API, or need an AI API key.
All drafting is done by the Claude you already use, which connects to Closewise as an MCP client.

Audit of this repository:

| Check | Result |
|---|---|
| AI/LLM packages in any `package.json` (root, `server`, `web`) | **None** |
| AI/LLM packages anywhere in `package-lock.json`, including indirect dependencies (465 packages scanned) | **None** (no `openai`, `@anthropic-ai/*`, `langchain`, `ai`/`@ai-sdk/*`, `@google/generative-ai`, `cohere-ai`, `ollama`, `@huggingface/*`, …) |
| Environment variables read by the code | `DATABASE_URL`, `JWT_SECRET`, `APP_URL`, `NODE_ENV`, `PORT`. **No AI keys** |
| Outbound network calls from the server | **None** except PostgreSQL. Browser code only calls same-origin `/api` and `/p/...` |
| External hosts referenced | Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) for typography only |
| AI vendor endpoints (`api.openai.com`, `api.anthropic.com`, …) | **None** |

`@modelcontextprotocol/sdk` is the *server* side of the Model Context Protocol. It exposes Closewise's
tools to your Claude. It doesn't call any model.

Re-run the dependency check yourself:

```bash
node -e "const l=require('./package-lock.json');const n=Object.keys(l.packages).map(k=>k.replace(/^.*node_modules\//,''));console.log(n.filter(x=>/openai|anthropic|langchain|^ai$|@ai-sdk|generative-ai|cohere|ollama|huggingface|mistral|groq/i.test(x)))"
# → []
```

---

## Connect to Claude in 3 steps

1. **Copy your MCP URL.** Sign in to Closewise and open **Connect to Claude**. Copy the URL
   (`https://<your-app>/mcp/<your-token>`). Treat it like a password. You can regenerate it there at any time.
2. **Add it to Claude.** In **claude.ai**, go to **Settings → Connectors → Add custom connector**,
   name it **Closewise**, paste the URL and click **Add**. No sign-in is needed: the URL is the key.
3. **Ask Claude.** In a new chat, make sure **Closewise** is enabled in the tools menu, then ask for a
   proposal. It appears on your dashboard within seconds.

> claude.ai must be able to reach the URL, so this works with the deployed app (see [DEPLOY.md](DEPLOY.md)),
> not with `localhost`.

---

## Test login

| | |
|---|---|
| Email | `demo@closewise.app` |
| Password | `Demo@1234` |

The account is created by `npm run db:seed`, which prints its MCP URL. It's for demos and testing.
If a deployed instance is publicly reachable, change its password or don't seed it there.

---

## Example prompts

- “Use Closewise to draft a proposal for a 5-page website redesign for my client, ₹1,20,000, valid for 14 days. Add an optional SEO setup add-on.”
- “Create a Closewise proposal for my client: logo design for ₹25,000, with brand guidelines (₹8,000) as an optional extra.”
- “List my Closewise proposals and tell me which ones the client has viewed but not accepted yet.”
- “Open my latest draft in Closewise and make the scope section more persuasive. Keep the prices as they are.”
- “Which of my Closewise proposals have expired? Extend the ones still in progress by two weeks.”
- “Publish my brand identity proposal in Closewise and give me the link to send.”

### MCP tools Claude can use

| Tool | What it does |
|---|---|
| `create_proposal` | Create a **draft** with sections (Markdown), line items and optional add-ons |
| `list_proposals` | List proposals with status, totals, ids and links (filter by status or text) |
| `get_proposal` | Full content, line item ids, totals and the activity log |
| `update_proposal` | Change fields; sections and line items are replaced as whole lists |
| `publish_proposal` | Make the public link live (Draft → Sent), only when you say it's ready |

Every tool returns plain text including the **edit URL** and the **public URL**.
Proposals created by Claude are marked **via Claude** and can't be deleted. Only manually created ones can.

---

## Run it locally

Requirements: Node 20+ and a PostgreSQL database (Neon works well; use its **direct**, non-pooler URL).

```bash
npm install
# create .env in the repo root:
#   DATABASE_URL="postgresql://…/neondb?sslmode=require"
#   JWT_SECRET="any-long-random-string"
#   APP_URL="http://localhost:3000"
npm run db:deploy     # apply migrations
npm run db:seed       # demo account + sample proposals
npm run dev           # web http://localhost:5173 · API/MCP http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Server (tsx watch, :3000) + web (Vite, :5173) |
| `npm run build` | Build web (`web/dist`) and server (`server/dist`) |
| `npm start` | Production: `prisma migrate deploy`, then start the server |
| `npm run db:migrate -- --name <change>` | Create and apply a migration in development |
| `npm run db:studio -w server` | Prisma Studio |

Deployment to Render's free tier, with a `render.yaml` Blueprint: see **[DEPLOY.md](DEPLOY.md)**.

---

## Project layout

```
server/                 Express + TypeScript + Prisma
  src/index.ts          app wiring: /api, /mcp, /p, /health, static SPA
  src/mcp.ts            MCP server and tool definitions
  src/api.ts            JSON API for the web app
  src/auth.ts           email/password auth, JWT cookie, MCP token
  src/publicPage.ts     client page routes (view / accept / decline)
  src/publicView.ts     client page HTML/CSS/browser script
  src/proposals.ts      money, totals, expiry and publish rules (shared)
  prisma/               schema, migrations, seed
web/                    React + Vite + Tailwind
  src/pages/            Login, Dashboard, Editor, Connect
  src/components/       UI kit, logo, app shell, dialogs
render.yaml             Render Blueprint (single free web service)
DEPLOY.md               deployment guide
```

**Stack:** Node 20 · Express 5 · TypeScript · Prisma · PostgreSQL (Neon) · React 19 · Vite · Tailwind CSS 4 ·
`@modelcontextprotocol/sdk` (Streamable HTTP, stateless) · zod
