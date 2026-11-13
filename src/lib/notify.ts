import "server-only";
import type { NotificationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/events";

/** Create a notification for a shop (userId omitted = everyone in the shop) and push it live. */
export async function notify(
  orgId: string,
  n: { type: NotificationType; title: string; body?: string; link?: string; userId?: string },
) {
  await prisma.notification.create({ data: { organizationId: orgId, ...n } });
  publish(orgId, { type: "notification" });
}
