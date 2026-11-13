import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, isPlatformAdmin } from "@/lib/session";

/**
 * Who may see which notifications, without redirecting (the bell renders inside the layout, also on
 * /no-organization and /unauthorized). Returns null when the user has no usable active shop.
 * Visible = this shop's rows that are org-wide (userId null) or addressed to the user.
 */
export async function notificationScope() {
  const session = await getSession();
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId) return null;
  if (!isPlatformAdmin(session.user)) {
    const member = await prisma.member.findFirst({ where: { organizationId: orgId, userId: session.user.id }, select: { id: true } });
    if (!member) return null;
  }
  const where = {
    organizationId: orgId,
    OR: [{ userId: null }, { userId: session.user.id }],
  } satisfies Prisma.NotificationWhereInput;
  return { orgId, userId: session.user.id, where };
}
