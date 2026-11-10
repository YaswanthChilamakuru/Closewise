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