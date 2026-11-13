"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { requireOrg } from "@/lib/session";
import { saveShopSettings } from "@/lib/shop-settings";
import { decrypt, encrypt } from "@/lib/crypto";
import { testSource } from "@/lib/inventory/source";
import { checkQuery, missingRequired, type InventoryRow } from "@/lib/inventory/sql";
import type { ActionResult } from "@/components/admin/types";
import { nameSchema, zodError } from "@/app/(app)/admin/_lib/accounts";

const settingsSchema = z.object({
  name: nameSchema,
  aiEnabled: z.boolean(),
  aiInstructions: z.string().trim().max(4000, "Udhëzimet lejojnë deri në 4000 karaktere."),
  currency: z.enum(["EUR", "ALL", "USD"]),
  defaultLanguage: z.enum(["sq", "en", "it"]),
});

export async function updateSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { name, ...settings } = parsed.data;

  // Prisma directly: the org plugin's updateOrganization requires membership (platform admins may not be members).
  await prisma.organization.update({ where: { id: orgId }, data: { name } });
  await saveShopSettings(orgId, settings);
  await logActivity({
    orgId, userId: user.id, action: "settings.updated", entityType: "organization", entityId: orgId,
    meta: { name, aiEnabled: settings.aiEnabled, currency: settings.currency, defaultLanguage: settings.defaultLanguage },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Shop's own inventory DB (live, read-only). Platform admins only: the server can reach internal hosts.
// ---------------------------------------------------------------------------------------------------------------

const sourceSchema = z.object({
  dialect: z.enum(["POSTGRES", "MYSQL", "MSSQL"]),
  url: z.string().trim().max(1000), // empty = keep the saved one
  query: z.string().trim().min(10, "Shkruani query-n SELECT.").max(4000),
});

export type SourceTest = { columns: string[]; sample: InventoryRow[]; skipped: number };

async function testInput(orgId: string, input: z.input<typeof sourceSchema>) {
  const parsed = sourceSchema.safeParse(input);
  if (!parsed.success) return { error: zodError(parsed.error) };
  const { dialect, query } = parsed.data;
  let url = parsed.data.url;
  if (!url) {
    const saved = await prisma.inventorySource.findUnique({ where: { organizationId: orgId }, select: { url: true } });
    if (!saved) return { error: { ok: false as const, error: "Vendosni connection string-un." } };
    url = decrypt(saved.url);
  }
  try {
    checkQuery(query);
    const result = await testSource(dialect, url, query);
    const missing = missingRequired(result.columns);
    if (missing.length) return { error: { ok: false as const, error: `Query nuk kthen kolonat: ${missing.join(", ")}.` } };
    return { dialect, url, query, result };
  } catch (e) {
    return { error: { ok: false as const, error: `Lidhja ose query dështoi: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400) } };
  }
}

async function requirePlatformAdminOrg() {
  const ctx = await requireOrg();
  return ctx.platformAdmin ? ctx : null;
}

export async function testInventorySource(input: z.input<typeof sourceSchema>): Promise<ActionResult<SourceTest>> {
  const ctx = await requirePlatformAdminOrg();
  if (!ctx) return { ok: false, error: "Vetëm administratori i platformës." };
  const t = await testInput(ctx.orgId, input);
  return "error" in t ? t.error! : { ok: true, data: t.result };
}

export async function saveInventorySource(input: z.input<typeof sourceSchema>): Promise<ActionResult<SourceTest>> {
  const ctx = await requirePlatformAdminOrg();
  if (!ctx) return { ok: false, error: "Vetëm administratori i platformës." };
  const t = await testInput(ctx.orgId, input);
  if ("error" in t) return t.error!;
  const data = {
    dialect: t.dialect,
    url: encrypt(t.url),
    query: t.query,
    columns: t.result.columns,
    isActive: true,
    lastError: null,
    lastCheckedAt: new Date(),
  };
  await prisma.inventorySource.upsert({ where: { organizationId: ctx.orgId }, create: { organizationId: ctx.orgId, ...data }, update: data });
  await logActivity({ orgId: ctx.orgId, userId: ctx.user.id, action: "inventory_source.saved", entityType: "organization", entityId: ctx.orgId, meta: { dialect: t.dialect } });
  revalidatePath("/", "layout");
  return { ok: true, data: t.result };
}

export async function removeInventorySource(): Promise<ActionResult> {
  const ctx = await requirePlatformAdminOrg();
  if (!ctx) return { ok: false, error: "Vetëm administratori i platformës." };
  await prisma.inventorySource.deleteMany({ where: { organizationId: ctx.orgId } });
  await logActivity({ orgId: ctx.orgId, userId: ctx.user.id, action: "inventory_source.removed", entityType: "organization", entityId: ctx.orgId });
  revalidatePath("/", "layout");
  return { ok: true };
}
