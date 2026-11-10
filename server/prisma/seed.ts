import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db";
import { env } from "../src/env";

const APP_URL = env.APP_URL;

const DEMO_EMAIL = "demo@closewise.app";
const DEMO_PASSWORD = "Demo@1234";

const newToken = () => crypto.randomBytes(24).toString("base64url");
const newSlug = () => crypto.randomBytes(8).toString("hex");
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Upsert keeps the existing mcpToken stable across re-seeds.
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: { email: DEMO_EMAIL, passwordHash, name: "Design Studio", mcpToken: newToken() },
  });

  // Re-runnable: replace the demo user's proposals.
  await prisma.proposal.deleteMany({ where: { userId: user.id } });

  const p1 = await prisma.proposal.create({
    data: {
      userId: user.id,
      slug: newSlug(),
      title: "Website Redesign for Acme Bakery",
      clientName: "Acme Bakery",
      clientEmail: "owner@acmebakery.example",
      currency: "INR",
      validUntil: daysFromNow(30),
      status: "SENT",
      source: "MANUAL",
      sections: [
        { heading: "Overview", body: "Acme Bakery needs a fast, mobile-first website that shows off the menu and takes **pre-orders** for cakes." },
        { heading: "Scope", body: "- 5-page responsive site\n- Menu CMS\n- Pre-order form with WhatsApp notification" },
        { heading: "Timeline", body: "Design in week 1, build in weeks 2-3, launch in week 4." },
      ],
      lineItems: {
        create: [
          { name: "UX & visual design", description: "Wireframes + 2 rounds of revisions", quantity: 1, unitPrice: 4500000, position: 0 },
          { name: "Development", description: "Responsive build, CMS setup (hours)", quantity: 40, unitPrice: 150000, position: 1 },
          { name: "SEO starter pack", description: "Meta tags, sitemap, Google Business setup", quantity: 1, unitPrice: 1200000, optional: true, position: 2 },
        ],
      },
      activities: { create: [{ type: "CREATED" }, { type: "PUBLISHED" }] },
    },
  });

  const p2 = await prisma.proposal.create({
    data: {
      userId: user.id,
      slug: newSlug(),
      title: "Brand Identity Package for Northwind Studio",
      clientName: "Northwind Studio",
      clientEmail: "hello@northwind.example",
      currency: "USD",
      validUntil: daysFromNow(14),
      status: "DRAFT",
      source: "CLAUDE",
      sections: [
        { heading: "Goals", body: "Create a distinctive, flexible identity for Northwind's relaunch." },
        { heading: "Deliverables", body: "1. Logo suite (primary, mark, wordmark)\n2. Color & type system\n3. 12-page brand guidelines PDF" },
      ],
      lineItems: {
        create: [
          { name: "Discovery workshop", quantity: 1, unitPrice: 80000, position: 0 },
          { name: "Logo & identity design", quantity: 1, unitPrice: 250000, position: 1 },
          { name: "Brand guidelines", quantity: 1, unitPrice: 120000, position: 2 },
          { name: "Social media kit", description: "Templates for Instagram and LinkedIn", quantity: 1, unitPrice: 60000, optional: true, position: 3 },
        ],
      },
      activities: { create: [{ type: "CREATED", meta: { via: "seed" } }] },
    },
  });

  console.log("\nSeed complete");
  console.log(`  User:      ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  mcpToken:  ${user.mcpToken}`);
  console.log(`  MCP URL:   ${APP_URL}/mcp/${user.mcpToken}`);
  console.log("  Proposals:");
  for (const p of [p1, p2]) console.log(`    - ${p.title} [${p.status}] ${APP_URL}/p/${p.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
