import Link from "next/link";
import { Hand, MessagesSquare, PackageX, ShoppingCart, MessageCircleWarning, Inbox } from "lucide-react";
import type { ConversationMode, OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "./stat-tile";
import { DailyChart, type DailyChartData } from "./daily-chart";
import { EmptyState, OrderStatusBadge } from "./bits";
import { CHANNEL_LABEL, dailyChartData, intFormat, localDayStart, moneyFormatter, shopSettings, timeAgo } from "./lib";

// Every loader takes the orgId from the page's requireOrg(); nothing here authenticates on its own.

/* ---------------------------------- KPIs --------------------------------- */

type Kpis = { todayOrders: number; todayRevenue: string; open: number; waiting: number; outOfStock: number };

export async function KpiSection({ orgId }: { orgId: string }) {
  const [todayStart, settings] = await Promise.all([localDayStart(0), shopSettings(orgId)]);
  const [orders, revenue, open, waiting, outOfStock] = await Promise.all([
    prisma.order.count({ where: { organizationId: orgId, createdAt: { gte: todayStart } } }),
    prisma.order.aggregate({
      where: { organizationId: orgId, createdAt: { gte: todayStart }, status: { not: "CANCELLED" } },
      _sum: { total: true },
    }),
    prisma.conversation.count({ where: { organizationId: orgId, mode: { not: "CLOSED" } } }),
    prisma.conversation.count({ where: { organizationId: orgId, mode: "HUMAN", unreadCount: { gt: 0 } } }),
    prisma.product.count({ where: { organizationId: orgId, isActive: true, stock: { lte: 0 } } }),
  ]);
  return (
    <KpiTiles
      k={{
        todayOrders: orders,
        todayRevenue: moneyFormatter(settings.currency)(Number(revenue._sum.total ?? 0)),
        open,
        waiting,
        outOfStock,
      }}
    />
  );
}

export function KpiTiles({ k }: { k: Kpis }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Porositë sot" value={intFormat.format(k.todayOrders)} hint={`Të ardhura: ${k.todayRevenue}`} icon={ShoppingCart} href="/orders" />
      <StatTile label="Biseda të hapura" value={intFormat.format(k.open)} hint="AI ose operator" icon={MessagesSquare} href="/conversations" />
      <StatTile
        label="Presin operatorin"
        value={intFormat.format(k.waiting)}
        hint="Në modalitet njerëzor me mesazhe të palexuara"
        icon={Hand}
        href="/conversations"
      />
      <StatTile label="Pa stok" value={intFormat.format(k.outOfStock)} hint="Produkte aktive me stok 0" icon={PackageX} href="/stock" />
    </div>
  );
}

export const SAMPLE_KPIS: Kpis = { todayOrders: 12, todayRevenue: "1234,50 €", open: 24, waiting: 3, outOfStock: 5 };

/* --------------------------------- Chart --------------------------------- */

export async function ChartSection({ orgId }: { orgId: string }) {
  return <ChartCard data={await dailyChartData(orgId, 14)} />;
}

export function ChartCard({ data }: { data: DailyChartData | null }) {
  const empty = data?.empty;
  return (
    <Card>
      <CardHeader>
        <CardTitle>14 ditët e fundit</CardTitle>
        <CardDescription>Porositë dhe të ardhurat për ditë (pa porositë e anuluara në të ardhura)</CardDescription>
      </CardHeader>
      <CardContent>
        {data === null ? (
          <div className="h-[316px] rounded-lg bg-muted" />
        ) : empty ? (
          <EmptyState icon={ShoppingCart} title="Ende pa porosi" description="Porositë e 14 ditëve të fundit do të shfaqen këtu." />
        ) : (
          <DailyChart data={data} />
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------------- Latest orders ----------------------------- */

type OrderRow = { id: string; number: number; customer: string; items: number; total: string; status: OrderStatus; ago: string };

export async function LatestOrdersSection({ orgId }: { orgId: string }) {
  const [orders, settings] = await Promise.all([
    prisma.order.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        createdAt: true,
        customer: { select: { name: true, phone: true, externalId: true } },
        _count: { select: { items: true } },
      },
    }),
    shopSettings(orgId),
  ]);
  const money = moneyFormatter(settings.currency);
  return (
    <LatestOrders
      rows={orders.map((o) => ({
        id: o.id,
        number: o.number,
        customer: o.customer.name ?? o.customer.phone ?? o.customer.externalId,
        items: o._count.items,
        total: money(Number(o.total)),
        status: o.status,
        ago: timeAgo(o.createdAt),
      }))}
    />
  );
}

export function LatestOrders({ rows }: { rows: OrderRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Porositë e fundit</CardTitle>
        <CardDescription>
          <Link href="/orders" className="hover:text-foreground underline underline-offset-4">
            Shiko të gjitha
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Ende pa porosi" description="Porositë e krijuara nga asistenti ose operatorët shfaqen këtu." />
        ) : (
          <ul className="-mx-2 divide-y">
            {rows.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/orders?order=${o.id}`}
                  className="hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      #{o.number} · {o.customer}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {o.items} {o.items === 1 ? "artikull" : "artikuj"} · {o.ago}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-medium tabular-nums">{o.total}</span>
                    <OrderStatusBadge status={o.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export const SAMPLE_ORDERS: OrderRow[] = Array.from({ length: 5 }, (_, i) => ({
  id: `s${i}`,
  number: 1000 + i,
  customer: "Emër Mbiemër",
  items: 2,
  total: "129,00 €",
  status: "PENDING",
  ago: "rreth 2 orë më parë",
}));

/* -------------------------- Conversations to handle ----------------------- */

type ConvRow = { id: string; customer: string; channel: string; mode: ConversationMode; unread: number; preview: string; ago: string };

export async function AttentionSection({ orgId }: { orgId: string }) {
  // Human-mode conversations: the AI is silent, an operator must answer. Unread first, then most recent.
  const convs = await prisma.conversation.findMany({
    where: { organizationId: orgId, mode: "HUMAN" },
    orderBy: [{ unreadCount: "desc" }, { lastMessageAt: "desc" }],
    take: 5,
    select: {
      id: true,
      mode: true,
      unreadCount: true,
      lastMessageAt: true,
      customer: { select: { name: true, phone: true, externalId: true } },
      channel: { select: { type: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { text: true, mediaType: true } },
    },
  });
  return (
    <AttentionList
      rows={convs.map((c) => ({
        id: c.id,
        customer: c.customer.name ?? c.customer.phone ?? c.customer.externalId,
        channel: CHANNEL_LABEL[c.channel.type],
        mode: c.mode,
        unread: c.unreadCount,
        preview: c.messages[0]?.text ?? (c.messages[0]?.mediaType ? "Media" : ""),
        ago: timeAgo(c.lastMessageAt),
      }))}
    />
  );
}

export function AttentionList({ rows }: { rows: ConvRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bisedat që kërkojnë vëmendje</CardTitle>
        <CardDescription>Biseda të marra nga operatori, të palexuarat në krye</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title="Asgjë për të trajtuar" description="Asistenti po i menaxhon të gjitha bisedat." />
        ) : (
          <ul className="-mx-2 divide-y">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/conversations/${c.id}`}
                  className="hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <MessageCircleWarning className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.customer}</div>
                    <div className="text-muted-foreground truncate text-xs">{c.preview || "—"}</div>
                    <div className="text-muted-foreground truncate text-xs">
                      {c.channel} · {c.ago}
                    </div>
                  </div>
                  {c.unread > 0 && (
                    <Badge className="shrink-0" aria-label={`${c.unread} të palexuara`}>
                      {c.unread}
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export const SAMPLE_CONVS: ConvRow[] = Array.from({ length: 4 }, (_, i) => ({
  id: `s${i}`,
  customer: "Emër Mbiemër",
  channel: "WhatsApp",
  mode: "HUMAN",
  unread: 2,
  preview: "A e keni këtë produkt në magazinë?",
  ago: "5 minuta më parë",
}));
