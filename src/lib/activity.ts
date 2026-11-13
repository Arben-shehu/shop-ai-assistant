import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Audit trail. action is "<entity>.<verb>", e.g. "order.status_changed". Never throws. */
export async function logActivity(entry: {
  orgId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  meta?: Prisma.InputJsonValue;
}) {
  const { orgId, ...rest } = entry;
  await prisma.activityLog.create({ data: { organizationId: orgId ?? null, ...rest } }).catch(() => {});
}
