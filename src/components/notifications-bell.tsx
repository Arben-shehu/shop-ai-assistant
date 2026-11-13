import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { timeAgo } from "@/components/dashboard/lib";
import { notificationScope } from "@/components/dashboard/notifications/scope";
import { NotificationsPopover } from "@/components/dashboard/notifications/popover";

/** Header bell. Renders nothing when the user has no active shop. Streams so it never blocks the header. */
export function NotificationsBell() {
  return (
    <Suspense fallback={null}>
      <BellLoader />
    </Suspense>
  );
}

async function BellLoader() {
  const scope = await notificationScope();
  if (!scope) return null;
  const [unread, rows] = await Promise.all([
    prisma.notification.count({ where: { AND: [scope.where, { readAt: null }] } }),
    prisma.notification.findMany({
      where: scope.where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    }),
  ]);
  return (
    <NotificationsPopover
      unread={unread}
      items={rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: n.readAt !== null,
        ago: timeAgo(n.createdAt),
      }))}
    />
  );
}
