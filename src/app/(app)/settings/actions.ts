"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { requireOrg } from "@/lib/session";
import { saveShopSettings } from "@/lib/shop-settings";
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
