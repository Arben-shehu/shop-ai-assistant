import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// Per-shop settings live in Organization.metadata (JSON string, owned by Better Auth's org plugin).
export const shopSettingsSchema = z.object({
  aiEnabled: z.boolean().default(true),
  /** Extra instructions appended to the assistant's system prompt (tone, delivery info, opening hours...). */
  aiInstructions: z.string().max(4000).default(""),
  currency: z.string().default("EUR"),
  /** Default reply language when the customer's language is unclear. */
  defaultLanguage: z.enum(["sq", "en", "it"]).default("sq"),
});
export type ShopSettings = z.infer<typeof shopSettingsSchema>;

export function parseShopSettings(metadata: string | null | undefined): ShopSettings {
  let raw: unknown = {};
  try {
    raw = metadata ? JSON.parse(metadata) : {};
  } catch {}
  const r = shopSettingsSchema.safeParse(raw);
  return r.success ? r.data : shopSettingsSchema.parse({});
}

export async function getShopSettings(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { metadata: true, name: true } });
  return { name: org.name, ...parseShopSettings(org.metadata) };
}

export async function saveShopSettings(orgId: string, patch: Partial<ShopSettings>) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { metadata: true } });
  const next = shopSettingsSchema.parse({ ...parseShopSettings(org.metadata), ...patch });
  await prisma.organization.update({ where: { id: orgId }, data: { metadata: JSON.stringify(next) } });
  return next;
}
