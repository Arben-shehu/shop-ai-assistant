import { cache } from "react";
import { Bot, MessagesSquare, Package, Receipt, ShoppingCart, Wallet } from "lucide-react";
import type { ChannelType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { DailyChart, type DailyChartData } from "@/components/dashboard/daily-chart";
import { EmptyState, ORDER_STATUS_LABEL, ORDER_STATUSES } from "@/components/dashboard/bits";
import { CHANNEL_LABEL, dailyChartData, intFormat, localDayStart, moneyFormatter, shopSettings } from "@/components/dashboard/lib";
import { BarList, type BarListItem } from "./bar-list";

// Every loader takes the orgId from the page's requireOrg(). Message and OrderItem have no organizationId,
// so they are always scoped through their parent Conversation / Order.

const rangeStart = cache((days: number) => localDayStart(days - 1));
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");

const orderStats = cache(async (orgId: string, days: number) => {
  const start = await rangeStart(days);
  const rows = await prisma.order.groupBy({
    by: ["status"],
    where: { organizationId: orgId, createdAt: { gte: start } },
    _count: { _all: true },
    _sum: { total: true },
  });
  const byStatus = new Map(rows.map((r) => [r.status, { count: r._count._all, total: Number(r._sum.total ?? 0) }]));
  const orders = rows.reduce((s, r) => s + r._count._all, 0);
  const kept = rows.filter((r) => r.status !== "CANCELLED");
  const revenue = kept.reduce((s, r) => s + Number(r._sum.total ?? 0), 0);
  const keptCount = kept.reduce((s, r) => s + r._count._all, 0);
  return { byStatus, orders, revenue, aov: keptCount ? revenue / keptCount : 0 };
});

type ChannelRow = { channelId: string; name: string; type: ChannelType; total: number; human: number; aiOnly: number };

/** Conversations with at least one message in the range, per channel, split by who answered. */
const conversationStats = cache(async (orgId: string, days: number) => {
  const start = await rangeStart(days);
  const rows = await prisma.$queryRaw<ChannelRow[]>`
    WITH conv AS (
      SELECT c."channelId",
             bool_or(m.sender = 'OPERATOR') AS human,
             bool_or(m.sender = 'AI') AS ai
      FROM "Message" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE c."organizationId" = ${orgId} AND m."createdAt" >= ${start}
      GROUP BY c.id, c."channelId"
    )
    SELECT ch.id AS "channelId", ch.name, ch.type::text AS type,
           count(*)::int AS total,
           (count(*) FILTER (WHERE conv.human))::int AS human,
           (count(*) FILTER (WHERE conv.ai AND NOT conv.human))::int AS "aiOnly"
    FROM conv JOIN "Channel" ch ON ch.id = conv."channelId" AND ch."organizationId" = ${orgId}
    GROUP BY ch.id, ch.name, ch.type
    ORDER BY total DESC`;
  const sum = (k: "total" | "human" | "aiOnly") => rows.reduce((s, r) => s + r[k], 0);
  return { channels: rows, total: sum("total"), human: sum("human"), aiOnly: sum("aiOnly") };
});

/* ---------------------------------- KPIs --------------------------------- */

type Kpis = { orders: string; revenue: string; aov: string; conversations: string };

export async function AnalyticsKpis({ orgId, days }: { orgId: string; days: number }) {
  const [o, c, settings] = await Promise.all([orderStats(orgId, days), conversationStats(orgId, days), shopSettings(orgId)]);
  const money = moneyFormatter(settings.currency);
  return (
    <AnalyticsKpiTiles
      k={{ orders: intFormat.format(o.orders), revenue: money(o.revenue), aov: money(o.aov), conversations: intFormat.format(c.total) }}
    />
  );
}

export function AnalyticsKpiTiles({ k }: { k: Kpis }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Të ardhura" value={k.revenue} hint="Pa porositë e anuluara" icon={Wallet} />
      <StatTile label="Porosi" value={k.orders} hint="Të gjitha statuset" icon={ShoppingCart} />
      <StatTile label="Vlera mesatare e porosisë" value={k.aov} hint="Të ardhura / porosi jo të anuluara" icon={Receipt} />
      <StatTile label="Biseda aktive" value={k.conversations} hint="Me të paktën një mesazh në periudhë" icon={MessagesSquare} />
    </div>
  );
}

export const SAMPLE_ANALYTICS_KPIS: Kpis = { orders: "128", revenue: "12 345,00 €", aov: "96,45 €", conversations: "342" };

/* ------------------------------ Over time -------------------------------- */

export async function OverTimeSection({ orgId, days }: { orgId: string; days: number }) {
  return <OverTimeCard data={await dailyChartData(orgId, days)} />;
}

export function OverTimeCard({ data }: { data: DailyChartData | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Të ardhurat dhe porositë në kohë</CardTitle>
        <CardDescription>Për ditë; zgjidhni metrikën më poshtë</CardDescription>
      </CardHeader>
      <CardContent>
        {data === null ? (
          <div className="h-[356px] rounded-lg bg-muted" />
        ) : data.empty ? (
          <EmptyState icon={ShoppingCart} title="Asnjë porosi në këtë periudhë" description="Provoni një periudhë më të gjatë." />
        ) : (
          <DailyChart data={data} height={280} />
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------- Bar lists -------------------------------- */

function ListCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ListCardSkeleton({ title, rows = 5 }: { title: string; rows?: number }) {
  return (
    <ListCard title={title} description="Duke u ngarkuar">
      <BarList
        label={title}
        items={Array.from({ length: rows }, (_, i) => ({ key: `${i}`, label: "Emër shembull", value: rows - i, display: "000" }))}
      />
    </ListCard>
  );
}

export async function StatusSection({ orgId, days }: { orgId: string; days: number }) {
  const [o, settings] = await Promise.all([orderStats(orgId, days), shopSettings(orgId)]);
  const money = moneyFormatter(settings.currency);
  // Fixed pipeline order (not ranked): the statuses are a sequence.
  const items: BarListItem[] = ORDER_STATUSES.map((s) => {
    const r = o.byStatus.get(s) ?? { count: 0, total: 0 };
    return { key: s, label: ORDER_STATUS_LABEL[s], value: r.count, display: intFormat.format(r.count), sub: money(r.total) };
  });
  return (
    <ListCard title="Porositë sipas statusit" description={`${intFormat.format(o.orders)} porosi në periudhë`}>
      {o.orders === 0 ? (
        <EmptyState icon={ShoppingCart} title="Asnjë porosi" />
      ) : (
        <BarList label="Porositë sipas statusit" items={items} />
      )}
    </ListCard>
  );
}

export async function ChannelSection({ orgId, days }: { orgId: string; days: number }) {
  const c = await conversationStats(orgId, days);
  return (
    <ListCard title="Bisedat sipas kanalit" description="Biseda me të paktën një mesazh në periudhë">
      {c.total === 0 ? (
        <EmptyState icon={MessagesSquare} title="Asnjë bisedë" />
      ) : (
        <BarList
          label="Bisedat sipas kanalit"
          items={c.channels.map((ch) => ({
            key: ch.channelId,
            label: `${ch.name} · ${CHANNEL_LABEL[ch.type]}`,
            value: ch.total,
            display: intFormat.format(ch.total),
            sub: pct(ch.total, c.total),
          }))}
        />
      )}
    </ListCard>
  );
}

export async function HandlingSection({ orgId, days }: { orgId: string; days: number }) {
  const c = await conversationStats(orgId, days);
  const unanswered = c.total - c.human - c.aiOnly;
  const items: BarListItem[] = [
    { key: "ai", label: "Vetëm nga AI", value: c.aiOnly, display: pct(c.aiOnly, c.total), sub: intFormat.format(c.aiOnly) },
    { key: "human", label: "Me ndërhyrje të operatorit", value: c.human, display: pct(c.human, c.total), sub: intFormat.format(c.human) },
  ];
  if (unanswered > 0)
    items.push({ key: "none", label: "Pa përgjigje", value: unanswered, display: pct(unanswered, c.total), sub: intFormat.format(unanswered) });
  return (
    <ListCard title="AI kundrejt operatorit" description={`Pjesë nga ${intFormat.format(c.total)} biseda aktive në periudhë`}>
      {c.total === 0 ? (
        <EmptyState icon={Bot} title="Asnjë bisedë" />
      ) : (
        <BarList label="Trajtimi i bisedave" items={items} max={c.total} />
      )}
    </ListCard>
  );
}

type ProductRow = { key: string; name: string; qty: number; revenue: number };

const productStats = cache(async (orgId: string, days: number) => {
  const start = await rangeStart(days);
  return prisma.$queryRaw<ProductRow[]>`
    SELECT coalesce(oi."productId", oi.name) AS key,
           max(oi.name) AS name,
           sum(oi.quantity)::int AS qty,
           sum(oi.quantity * oi."unitPrice")::float8 AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o."organizationId" = ${orgId} AND o."createdAt" >= ${start} AND o.status <> 'CANCELLED'
    GROUP BY 1`;
});

export async function TopProductsSection({ orgId, days, by }: { orgId: string; days: number; by: "qty" | "revenue" }) {
  const [rows, settings] = await Promise.all([productStats(orgId, days), shopSettings(orgId)]);
  const money = moneyFormatter(settings.currency);
  const top = [...rows].sort((a, b) => b[by] - a[by]).slice(0, 6);
  const title = by === "qty" ? "Produktet më të shitura (sasi)" : "Produktet më të shitura (të ardhura)";
  return (
    <ListCard title={title} description="Pa porositë e anuluara">
      {top.length === 0 ? (
        <EmptyState icon={Package} title="Asnjë produkt i shitur" />
      ) : (
        <BarList
          label={title}
          items={top.map((p) => ({
            key: p.key,
            label: p.name,
            value: p[by],
            display: by === "qty" ? `${intFormat.format(p.qty)} copë` : money(p.revenue),
            sub: by === "qty" ? money(p.revenue) : `${intFormat.format(p.qty)} copë`,
          }))}
        />
      )}
    </ListCard>
  );
}
