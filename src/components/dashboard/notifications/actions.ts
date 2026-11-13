"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/events";
import { notificationScope } from "./scope";

// Server actions are public endpoints: the scope is re-derived from the session on every call.

export async function markNotificationRead(id: string) {
  const parsed = z.string().min(1).max(64).safeParse(id);
  const scope = await notificationScope();
  if (!scope || !parsed.success) return;
  const { count } = await prisma.notification.updateMany({
    where: { AND: [scope.where, { id: parsed.data, readAt: null }] },
    data: { readAt: new Date() },
  });
  if (count) done(scope.orgId);
}

export async function markAllNotificationsRead() {
  const scope = await notificationScope();
  if (!scope) return;
  const { count } = await prisma.notification.updateMany({
    where: { AND: [scope.where, { readAt: null }] },
    data: { readAt: new Date() },
  });
  if (count) done(scope.orgId);
}

function done(orgId: string) {
  // Org-wide rows share one readAt, so every open bell in the shop must refresh.
  publish(orgId, { type: "notification" });
  revalidatePath("/", "layout");
}
