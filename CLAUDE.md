# Project: Closewise

A proposal/quote tool for freelancers and small agencies. The user's OWN Claude
(claude.ai) connects to this app over MCP and does all the writing. THIS APP CONTAINS
NO AI: no OpenAI/Anthropic/LLM SDKs, keys or calls, ever. Do not add any.

## Stack
- Monorepo: /server (Node 20, Express, TypeScript, Prisma, PostgreSQL on Neon),
  /web (React, TypeScript, Vite, Tailwind)
- Single deploy on Render free web service: Express serves the built React app
  + /api + /mcp + /p/:slug + /health
- MCP: @modelcontextprotocol/sdk, Streamable HTTP transport, STATELESS mode
  (new server+transport per request, sessionIdGenerator: undefined), tools with zod schemas
- Web auth: email+password (bcrypt), JWT in httpOnly cookie
- MCP auth: per-user secret token in the URL path: POST /mcp/:token

## Commands (run from the repo root)
- `npm install`: install all workspaces (runs `prisma generate`)
- `npm run dev`: server (tsx watch, :3000) + web (Vite, :5173, proxies /api /mcp /p /health)
- `npm run build`: web (tsc + vite build → web/dist), then server (prisma generate + tsc → server/dist)
- `npm start`: production: `prisma migrate deploy`, then `node server/dist/index.js` (serves web/dist)
- `npm run serve -w server`: production server without running migrations
- `npm run db:migrate -- --name <change>`: create + apply a migration in dev (commit the folder)
- `npm run db:deploy`: apply pending migrations (what `npm start` runs)
- `npm run db:seed`: demo user demo@closewise.app / Demo@1234 + sample proposals; prints the MCP URL
- `npm run db:studio -w server`: Prisma Studio
- Typecheck only: `npx tsc -p server/tsconfig.json --noEmit` and `cd web && npx tsc --noEmit`
- Env vars live in the repo-root `.env`: DATABASE_URL (Neon direct), JWT_SECRET, APP_URL. See DEPLOY.md.

Gotchas:
- Windows: stop `npm run dev` before `npm install` / `prisma generate` (the engine DLL is locked → EPERM),
  or install with `--ignore-scripts`.
- `prisma migrate` fails with P1001 on networks with broken IPv6 while the app works (Node falls back
  to IPv4). Fix in DEPLOY.md → Troubleshooting.
- `tsx watch` may not pick up newly added files; restart `npm run dev` after adding server modules.

## Routes
- `/api/*` JSON API for the web app (cookie auth): auth, proposals CRUD/autosave/publish, stats, MCP token
- `/mcp/:token` MCP endpoint · `/health` liveness (no DB)
- `/p/:slug` public client page (server-rendered, no login): view tracking, accept/decline; drafts 404
- everything else: React SPA (login, dashboard, `/proposals/:id` editor, `/connect`)

## Data model
User(id, email, passwordHash, name, mcpToken unique)
Proposal(id, userId, slug unique, title, clientName, clientEmail, currency, validUntil,
  status: DRAFT|SENT|VIEWED|ACCEPTED|DECLINED, sections Json [{heading, body(markdown)}],
  acceptedBy, acceptedAt, selectedOptionalIds Json, source: CLAUDE|MANUAL, createdAt, updatedAt)
LineItem(id, proposalId, name, description, quantity, unitPrice, optional bool, position)
Activity(id, proposalId, type: CREATED|EDITED|PUBLISHED|VIEWED|ACCEPTED|DECLINED, meta Json, createdAt)

## Rules
- Small, working, polished beats many features. Finish each phase working end-to-end.
- Money stored as integers in minor units (paise/cents). Totals computed on the server.
- Every MCP tool returns clear text including editUrl and publicUrl (built from APP_URL).
- Tool descriptions must be detailed: they are the instructions Claude reads.
- No SQLite (Render free disk is wiped on restart). Use Postgres only.