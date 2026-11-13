"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, BellOff, CheckCheck, Hand, Info, LifeBuoy, ShoppingCart, type LucideIcon } from "lucide-react";
import type { NotificationType } from "@/generated/prisma/client";
import { useLiveEvents } from "@/hooks/use-live-events";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  ago: string;
};

const ICON: Record<NotificationType, LucideIcon> = {
  NEW_ORDER: ShoppingCart,
  HUMAN_NEEDED: Hand,
  CHANNEL_ERROR: AlertTriangle,
  TICKET_REPLY: LifeBuoy,
  SYSTEM: Info,
};

const internal = (link: string | null) => (link && link.startsWith("/") && !link.startsWith("//") ? link : null);

export function NotificationsPopover({ items, unread }: { items: NotificationItem[]; unread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  // `unread` counts every unread row, not only the 20 listed.
  const [{ list: shown, count }, markShown] = useOptimistic({ list: items, count: unread }, (state, id: string | null) => {
    if (id === null) return { list: state.list.map((n) => ({ ...n, read: true })), count: 0 };
    const hit = state.list.find((n) => n.id === id && !n.read);
    if (!hit) return state;
    return { list: state.list.map((n) => (n === hit ? { ...n, read: true } : n)), count: Math.max(0, state.count - 1) };
  });

  useLiveEvents({ filter: (e) => e.type === "notification" });

  function openItem(n: NotificationItem) {
    setOpen(false);
    startTransition(async () => {
      markShown(n.id);
      if (!n.read) await markNotificationRead(n.id);
      const href = internal(n.link);
      if (href) router.push(href);
    });
  }

  function markAll() {
    startTransition(async () => {
      markShown(null);
      await markAllNotificationsRead();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={count ? `Njoftimet, ${count} të palexuara` : "Njoftimet"}>
          <Bell />
          {count > 0 && (
            <span className="bg-destructive absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="font-medium">Njoftimet</span>
          <Button variant="ghost" size="xs" onClick={markAll} disabled={count === 0}>
            <CheckCheck data-icon="inline-start" />
            Shëno të gjitha si të lexuara
          </Button>
        </div>
        {shown.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center">
            <BellOff className="size-5" aria-hidden />
            <p className="text-foreground text-sm font-medium">Nuk keni njoftime</p>
            <p className="text-xs">Porositë e reja dhe bisedat që kërkojnë operator do të shfaqen këtu.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[min(24rem,70vh)]">
            <ul className="p-1">
              {shown.map((n) => {
                const Icon = ICON[n.type];
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        "hover:bg-muted flex w-full items-start gap-3 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        !n.read && "bg-muted/50",
                      )}
                    >
                      <span className="bg-muted mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
                        <Icon className="size-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm", !n.read && "font-medium")}>{n.title}</span>
                        {n.body && <span className="text-muted-foreground line-clamp-2 block text-xs">{n.body}</span>}
                        <span className="text-muted-foreground mt-0.5 block text-xs">{n.ago}</span>
                      </span>
                      {!n.read && (
                        <>
                          <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" aria-hidden />
                          <span className="sr-only">E palexuar</span>
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
