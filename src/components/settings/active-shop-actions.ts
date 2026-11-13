"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { isPlatformAdmin, requireUser } from "@/lib/session";
import type { ActionResult } from "@/components/admin/types";
import { setSessionShop } from "@/app/(app)/admin/_lib/accounts";

export type ShopOption = { id: string; name: string; slug: string; role: string | null; active: boolean };

/** Shops the current user can switch to: their memberships, or every shop for platform admins. */
export async function listMyShops(): Promise<ShopOption[]> {
  const session = await requireUser();
  const activeId = session.session.activeOrganizationId;
  const memberships = await prisma.member.findMany({
    where: { userId: session.user.id },
    select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
  });
  const roleOf = new Map(memberships.map((m) => [m.organization.id, m.role]));
  const orgs = isPlatformAdmin(session.user)
    ? await prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } })
    : memberships.map((m) => m.organization).sort((a, b) => a.name.localeCompare(b.name));
  return orgs.map((o) => ({ ...o, role: roleOf.get(o.id) ?? null, active: o.id === activeId }));
}

/**
 * Switch the session's active shop. Uses Prisma rather than auth.api.setActiveOrganization because the
 * latter rejects platform admins who aren't members; membership is checked here instead.
 */
export async function switchShop(input: { orgId: string }): Promise<ActionResult> {
  const session = await requireUser();
  const parsed = z.object({ orgId: z.string().min(1).max(100) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dyqan i pavlefshëm." };
  const { orgId } = parsed.data;

  const platformAdmin = isPlatformAdmin(session.user);
  const allowed = platformAdmin
    ? await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } })
    : await prisma.member.findFirst({ where: { organizationId: orgId, userId: session.user.id }, select: { id: true } });
  if (!allowed) return { ok: false, error: "Nuk keni akses në këtë dyqan." };

  await setSessionShop(session.session.id, orgId);
  if (platformAdmin) await logActivity({ orgId, userId: session.user.id, action: "shop.entered_by_admin", entityType: "organization", entityId: orgId });
  revalidatePath("/", "layout");
  return { ok: true };
}
