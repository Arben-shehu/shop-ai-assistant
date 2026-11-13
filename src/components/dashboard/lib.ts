import "server-only";
import { formatDistanceToNow } from "date-fns";
import { sq } from "date-fns/locale";
import type { ChannelType } from "@/generated/prisma/client";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getShopSettings } from "@/lib/shop-settings";

/** Shop settings, deduplicated per request (several sections need the currency). */
export const shopSettings = cache(getShopSettings);

// shortcut: there is no per-shop timezone setting yet; every shop is in Albania. Days are bucketed in this zone.
export const SHOP_TZ = "Europe/Tirane";

export const CHANNEL_LABEL: Record<ChannelType, string> = {
  WHATSAPP_OPENWA: "WhatsApp",
  WHATSAPP_META: "WhatsApp (Meta)",
  INSTAGRAM: "Instagram",
};

export function moneyFormatter(currency: string) {
  const f = new Intl.NumberFormat("sq-AL", { style: "currency", currency, maximumFractionDigits: 2 });
  return (n: number) => f.format(n);
}

export const intFormat = new Intl.NumberFormat("sq-AL");

const dateTimeFormat = new Intl.DateTimeFormat("sq-AL", { timeZone: SHOP_TZ, dateStyle: "medium", timeStyle: "short" });
export const formatDateTime = (d: Date) => dateTimeFormat.format(d);
export const timeAgo = (d: Date) => formatDistanceToNow(d, { addSuffix: true, locale: sq });

/** Start of the shop's local day `daysBack` days ago (0 = today), as an absolute instant. */
export async function localDayStart(daysBack: number): Promise<Date> {
  const [row] = await prisma.$queryRaw<{ start: Date }[]>`
    SELECT ((date_trunc('day', now() AT TIME ZONE ${SHOP_TZ}) - make_interval(days => ${daysBack}::int)) AT TIME ZONE ${SHOP_TZ}) AS start`;
  return row.start;
}

export type DailyPoint = { day: string; label: string; orders: number; revenue: number };

const dayLabelFormat = new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", timeZone: "UTC" });

/** Orders and revenue (non-cancelled) per local day for the last `days` days, today included, gaps filled with 0. */
export async function dailyOrders(orgId: string, days: number): Promise<DailyPoint[]> {
  const rows = await prisma.$queryRaw<{ day: string; orders: number; revenue: number }[]>`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', now() AT TIME ZONE ${SHOP_TZ}) - make_interval(days => ${days - 1}::int),
        date_trunc('day', now() AT TIME ZONE ${SHOP_TZ}),
        interval '1 day'
      ) AS d
    ),
    o AS (
      SELECT date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${SHOP_TZ}) AS d, status, total
      FROM "Order"
      WHERE "organizationId" = ${orgId}
        AND "createdAt" >= ((date_trunc('day', now() AT TIME ZONE ${SHOP_TZ}) - make_interval(days => ${days - 1}::int)) AT TIME ZONE ${SHOP_TZ}) AT TIME ZONE 'UTC'
    )
    SELECT to_char(days.d, 'YYYY-MM-DD') AS day,
           count(o.d)::int AS orders,
           coalesce(sum(o.total) FILTER (WHERE o.status <> 'CANCELLED'), 0)::float8 AS revenue
    FROM days LEFT JOIN o ON o.d = days.d
    GROUP BY days.d
    ORDER BY days.d`;
  return rows.map((r) => ({ ...r, label: dayLabelFormat.format(new Date(`${r.day}T00:00:00Z`)) }));
}

/**
 * Chart-ready daily series. Every display string is formatted here on the server: browsers' ICU data for
 * "sq-AL" differs (some fall back to "€749.99"), which would mismatch the server HTML on hydration.
 */
export async function dailyChartData(orgId: string, days: number) {
  const [points, settings] = await Promise.all([dailyOrders(orgId, days), shopSettings(orgId)]);
  const money = moneyFormatter(settings.currency);
  const orders = points.reduce((s, d) => s + d.orders, 0);
  const revenue = points.reduce((s, d) => s + d.revenue, 0);
  return {
    points: points.map((p) => ({ ...p, revenueText: money(p.revenue), ordersText: intFormat.format(p.orders) })),
    totals: { orders: intFormat.format(orders), revenue: money(revenue) },
    empty: orders === 0,
  };
}
