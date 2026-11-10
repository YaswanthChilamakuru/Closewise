import { env } from "./env";
import fs from "fs";
import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import { prisma } from "./db";
import { mcpRouter } from "./mcp";

const app = express();
// Render (and most PaaS) terminate TLS at one proxy hop: trust it so req.ip / req.secure are correct.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Liveness probe for Render: must be fast and must NOT touch the database
// (a Neon cold start would otherwise fail health checks and restart the service).
app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store").type("text").send("ok");
});

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const api = express.Router();
api.get("/ping", (_req, res) => {
  res.json({ ok: true });
});
api.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use("/api", api);
app.use("/mcp", mcpRouter);

// Serve the built React app (web/dist) with SPA fallback for client-side routes.
// Resolves to <repo>/web/dist from both src/ (tsx) and dist/ (compiled).
const webDist = path.resolve(__dirname, "../../web/dist");
const indexHtml = path.join(webDist, "index.html");
// Paths owned by the server: never answered with index.html.
const SERVER_PATHS = /^\/(?:api|mcp|p|health)(?:\/|$)/;

if (fs.existsSync(indexHtml)) {
  // Vite emits content-hashed files under /assets: safe to cache forever.
  app.use("/assets", express.static(path.join(webDist, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(webDist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // Server routes and missing files (e.g. /assets/old-hash.js, /favicon.ico) get a real 404, not HTML.
    if (SERVER_PATHS.test(req.path) || req.path.startsWith("/assets/") || path.extname(req.path)) return next();
    res.set("Cache-Control", "no-cache").sendFile(indexHtml);
  });
} else {
  app.get("/", (_req, res) => {
    res.type("text").send("Closewise API running. No web build found: run `npm run build`, or use the Vite dev server.");
  });
}

app.use((_req, res) => {
  res.status(404).type("text").send("Not found");
});

// Render sets PORT; bind all interfaces so the platform router can reach us.
const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`Closewise server listening on port ${env.PORT} (${env.NODE_ENV}), APP_URL=${env.APP_URL}`);
});

// Render sends SIGTERM on deploys/spin-down: finish in-flight requests, close the DB pool.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
