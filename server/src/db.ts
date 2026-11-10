import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

// node-postgres driver adapter: connections go through Node's networking stack
// (works behind restrictive sandboxes/proxies and on Render alike).
// node-postgres warns about libpq `sslmode` semantics, so translate it into an explicit
// verified-TLS config (same behaviour it uses today for sslmode=require).
function pgConfig(url: string) {
  const u = new URL(url);
  const sslmode = u.searchParams.get("sslmode");
  u.searchParams.delete("sslmode");
  u.searchParams.delete("channel_binding");
  const ssl = sslmode && sslmode !== "disable" ? { rejectUnauthorized: true } : undefined;
  return { connectionString: u.toString(), ssl };
}

const adapter = new PrismaPg(pgConfig(env.DATABASE_URL));

export const prisma = new PrismaClient({ adapter });
