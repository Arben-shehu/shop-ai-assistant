"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { requireOrg } from "@/lib/session";
import { saveShopSettings } from "@/lib/shop-settings";
import { decrypt, encrypt } from "@/lib/crypto";
import { testNamedQuery, testSource } from "@/lib/inventory/source";
import {
  buildNamed,
  CUSTOMER_COLUMNS,
  checkQuery,
  missingColumns,
  missingRequired,
  STATUS_COLUMNS,
  type Dialect,
  type InventoryRow,
  type NamedParam,
} from "@/lib/inventory/sql";
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
  // Optional ERP queries; empty = not used.
  customerQuery: z.string().trim().max(4000).optional(),
  historyQuery: z.string().trim().max(4000).optional(),
  orderStatusQuery: z.string().trim().max(4000).optional(),
});

/** Each optional query: its parameter, the sample value it is tested with, and the columns it must return. */
const NAMED: { key: "customerQuery" | "historyQuery" | "orderStatusQuery"; label: string; param: NamedParam; sample: string; required: readonly string[] }[] = [
  { key: "customerQuery", label: "Query i klientit", param: "phone", sample: "000000000", required: CUSTOMER_COLUMNS },
  { key: "historyQuery", label: "Query i historikut", param: "client_id", sample: "0", required: [] },
  { key: "orderStatusQuery", label: "Query i statusit të porosisë", param: "ref", sample: "AI-0", required: STATUS_COLUMNS },
];

/** Validate (single SELECT, uses exactly its parameter) and run with the sample value. Returns an error text or null. */
async function testNamed(dialect: Dialect, url: string, values: Record<string, string | null>): Promise<string | null> {
  for (const n of NAMED) {
    const q = values[n.key];
    if (!q) continue;
    try {
      buildNamed(dialect, q, n.param, n.sample, 1);
    } catch (e) {
      return `${n.label}: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      const r = await testNamedQuery(dialect, url, q, n.param, n.sample);
      const missing = missingColumns(r.columns, n.required);
      if (missing.length) return `${n.label} nuk kthen kolonat: ${missing.join(", ")}.`;
    } catch (e) {
      return `${n.label} dështoi me :${n.param} = '${n.sample}': ${e instanceof Error ? e.message : String(e)}`.slice(0, 400);
    }
  }
  return null;
}

export type SourceTest = { columns: string[]; sample: InventoryRow[]; skipped: number };

async function testInput(orgId: string, input: z.input<typeof sourceSchema>) {
  const parsed = sourceSchema.safeParse(input);
  if (!parsed.success) return { error: zodError(parsed.error) };
  const { dialect, query } = parsed.data;
  const named = {
    customerQuery: parsed.data.customerQuery || null,
    historyQuery: parsed.data.historyQuery || null,
    orderStatusQuery: parsed.data.orderStatusQuery || null,
  };
  if (named.historyQuery && !named.customerQuery) {
    return { error: { ok: false as const, error: "Query i historikut kërkon edhe query-n e klientit (client_id vjen prej tij)." } };
  }
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
    const namedError = await testNamed(dialect, url, named);
    if (namedError) return { error: { ok: false as const, error: namedError } };
    return { dialect, url, query, named, result };
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
    ...t.named,
    columns: t.result.columns,
    isActive: true,
    lastError: null,
    lastCheckedAt: new Date(),
  };
  await prisma.inventorySource.upsert({ where: { organizationId: ctx.orgId }, create: { organizationId: ctx.orgId, ...data }, update: data });
  await logActivity({ orgId: ctx.orgId, userId: ctx.user.id, action: "inventory_source.saved", entityType: "organization", entityId: ctx.orgId, meta: { dialect: t.dialect, customerQuery: Boolean(t.named.customerQuery), historyQuery: Boolean(t.named.historyQuery), orderStatusQuery: Boolean(t.named.orderStatusQuery) } });
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
