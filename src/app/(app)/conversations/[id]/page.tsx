import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { getShopSettings } from "@/lib/shop-settings";
import { Button } from "@/components/ui/button";
import { ChannelIcon, CHANNEL_LABEL } from "@/components/conversations/channel-icon";
import { Composer } from "@/components/conversations/composer";
import { CustomerAvatar, customerLabel } from "@/components/conversations/customer-avatar";
import { CustomerPanel, CustomerSheet, type PanelOrder } from "@/components/conversations/customer-panel";
import { MessageBubble } from "@/components/conversations/message-bubble";
import { MessageLog } from "@/components/conversations/message-log";
import { ModeActions } from "@/components/conversations/mode-actions";
import { ModeBadge } from "@/components/conversations/mode-badge";
import { filtersQuery, getThread, parseFilters, THREAD_LIMIT } from "../_lib/queries";

export const metadata: Metadata = { title: "Biseda" };

export default async function ConversationPage({ params, searchParams }: PageProps<"/conversations/[id]">) {
  const { orgId, user } = await requireOrg();
  const { id } = await params;
  const [thread, settings, sp] = await Promise.all([getThread(orgId, id), getShopSettings(orgId), searchParams]);
  if (!thread) notFound();

  const name = customerLabel(thread.customer);
  const money = new Intl.NumberFormat("sq-AL", { style: "currency", currency: settings.currency });
  const orders: PanelOrder[] = thread.orders.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    total: money.format(Number(o.total)),
    createdAt: o.createdAt.toISOString(),
  }));
  const customer = { id: thread.customer.id, name: thread.customer.name, phone: thread.customer.phone, address: thread.customer.address };
  const lastMessage = thread.messages.at(-1);

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b p-3">
        <Button asChild variant="ghost" size="icon" className="-ml-1 md:hidden">
          <Link href={`/conversations${filtersQuery(parseFilters(sp))}`} aria-label="Kthehu te lista e bisedave">
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <CustomerAvatar name={thread.customer.name} className="hidden sm:flex" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{name}</h2>
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <ChannelIcon type={thread.channel.type} />
            <span className="truncate">
              {CHANNEL_LABEL[thread.channel.type]}
              {thread.customer.phone && thread.customer.name ? ` · ${thread.customer.phone}` : ""}
              {thread.mode === "HUMAN" && thread.assignee ? ` · Operator: ${thread.assignee.name}` : ""}
            </span>
          </p>
        </div>
        <CustomerSheet customer={customer} orders={orders} />
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
          <ModeBadge mode={thread.mode} />
          <ModeActions conversationId={thread.id} mode={thread.mode} assignedToMe={thread.assigneeId === user.id} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageLog conversationId={thread.id} lastMessageId={lastMessage?.id ?? null} unreadCount={thread.unreadCount}>
            {thread.messages.length === THREAD_LIMIT && (
              <li className="text-muted-foreground text-center text-xs">Shfaqen {THREAD_LIMIT} mesazhet e fundit.</li>
            )}
            {thread.messages.length === 0 && (
              <li className="text-muted-foreground py-8 text-center text-sm">Ende pa mesazhe.</li>
            )}
            {thread.messages.map((m) => (
              <MessageBubble key={m.id} message={m} customerName={name} />
            ))}
          </MessageLog>
          <Composer key={thread.id} conversationId={thread.id} mode={thread.mode} />
        </div>
        <aside aria-label="Klienti" className="hidden w-80 shrink-0 overflow-y-auto border-l p-4 xl:block">
          <CustomerPanel customer={customer} orders={orders} />
        </aside>
      </div>
    </>
  );
}
