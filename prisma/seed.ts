import "dotenv/config";
import { randomBytes } from "node:crypto";
import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import products from "./data/computers.json";

// Idempotent: safe to run twice. Password from SEED_PASSWORD or random (printed once).
const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString("base64url");

async function upsertUser(email: string, name: string, role: string | null) {
  const ctx = await auth.$context;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const user = await prisma.user.create({
    data: { id: randomBytes(12).toString("hex"), email, name, role, emailVerified: true },
  });
  await prisma.account.create({
    data: {
      id: randomBytes(12).toString("hex"),
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await ctx.password.hash(password),
    },
  });
  return user;
}

async function main() {
  const admin = await upsertUser("admin@shop-ai.local", "Platform Admin", "admin");
  const owner = await upsertUser("owner@techstore.al", "TechStore Owner", "user");
  const agent = await upsertUser("agent@techstore.al", "TechStore Operator", "user");

  const org =
    (await prisma.organization.findUnique({ where: { slug: "demo-computer-shop" } })) ??
    (await prisma.organization.create({
      data: { id: randomBytes(12).toString("hex"), name: "Demo Computer Shop", slug: "demo-computer-shop", createdAt: new Date() },
    }));

  for (const [user, role] of [[owner, "owner"], [agent, "member"]] as const) {
    const has = await prisma.member.findFirst({ where: { organizationId: org.id, userId: user.id } });
    if (!has)
      await prisma.member.create({
        data: { id: randomBytes(12).toString("hex"), organizationId: org.id, userId: user.id, role, createdAt: new Date() },
      });
  }

  for (const p of products) {
    await prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: p.sku } },
      update: {},
      create: { ...p, organizationId: org.id },
    });
  }

  console.log(`Seeded org "${org.name}" with ${products.length} products.`);
  console.log(`Users (new ones get password: ${password}):`);
  console.log(`  ${admin.email} (platform admin)\n  ${owner.email} (shop owner)\n  ${agent.email} (operator)`);
}

main().finally(() => prisma.$disconnect());
