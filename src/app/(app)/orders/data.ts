import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import { CHANNEL_LABEL, PERIODS, type Period } from "@/components/orders/order-status";
import type { OrderDetailData } from "@/components/orders/order-detail";
import type { OrderRowData } from "@/components/orders/orders-table";

export type OrderFilters = { status: OrderStatus | null; q: string; period: Period; page: number; orderId: string | null };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseOrderFilters(sp: Record<string, string | string[] | undefined>): OrderFilters {
  const status = first(sp.status);
  const period = first(sp.period);
  const page = Number.parseInt(first(sp.page), 10);
  const orderId = first(sp.order);
  return {
    status: Object.hasOwn(OrderStatus, status) ? (status as OrderStatus) : null,
    q: first(sp.q).trim().slice(0, 100),
    period: Object.hasOwn(PERIODS, period) ? (period as Period) : "all",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
    orderId: /^[a-z0-9]{1,64}$/i.test(orderId) ? orderId : null,
  };
}

/** Stored phone, else the WhatsApp id (E.164 digits). Instagram ids are not phone numbers. */
function customerPhone(c: { phone: string | null; externalId: string }, channel: string | undefined) {
  return c.phone ?? (channel?.startsWith("WHATSAPP") ? `+${c.externalId}` : null);
}

function periodStart(period: Period): Date | undefined {
  if (period === "all") return undefined;
  const d = new Date();
  if (period === "today") d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (period === "7d" ? 7 : 30));
  return d;
}

/** Org + search + period (status is applied separately so the tabs can show per-status counts). */
export function baseOrderWhere(orgId: string, f: Pick<OrderFilters, "q" | "period">): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { organizationId: orgId };
  const from = periodStart(f.period);
  if (from) where.createdAt = { gte: from };
  if (f.q) {
    const or: Prisma.OrderWhereInput[] = [
      { customer: { name: { contains: f.q, mode: "insensitive" } } },
      { customer: { phone: { contains: f.q } } },
      { customer: { externalId: { contains: f.q } } },
    ];
    const num = f.q.replace(/^#/, "");
    if (/^\d{1,9}$/.test(num)) or.push({ number: Number(num) });
    where.OR = or;
  }
  return where;
}

export async function getStatusCounts(orgId: string, f: OrderFilters) {
  const groups = await prisma.order.groupBy({ by: ["status"], where: baseOrderWhere(orgId, f), _count: { _all: true } });
  const counts: Partial<Record<OrderStatus | "all", number>> = { all: 0 };
  for (const g of groups) {
    counts[g.status] = g._count._all;
    counts.all! += g._count._all;
  }
  return counts;
}

export async function getOrderRows(orgId: string, f: OrderFilters, pageSize: number, currency: string) {
  const where: Prisma.OrderWhereInput = { ...baseOrderWhere(orgId, f), ...(f.status ? { status: f.status } : {}) };
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        createdAt: true,
        customer: { select: { name: true, phone: true, externalId: true } },
        conversation: { select: { channel: { select: { type: true } } } },
        items: { select: { quantity: true } },
      },
    }),
  ]);
  const rows: OrderRowData[] = orders.map((o) => ({
    id: o.id,
    number: o.number,
    customerName: o.customer.name,
    customerPhone: customerPhone(o.customer, o.conversation?.channel.type),
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    totalLabel: formatMoney(o.total, currency),
    status: o.status,
    channelLabel: o.conversation ? CHANNEL_LABEL[o.conversation.channel.type] ?? null : null,
    createdRelative: formatRelative(o.createdAt),
    createdLabel: formatDate(o.createdAt, { time: true }),
  }));
  return { total, rows };
}

export async function getOrderDetail(orgId: string, orderId: string, currency: string): Promise<OrderDetailData | null> {
  const o = await prisma.order.findFirst({
    where: { id: orderId, organizationId: orgId },
    include: {
      customer: { select: { name: true, phone: true, externalId: true } },
      conversation: { select: { id: true, channel: { select: { type: true } } } },
      items: { orderBy: { id: "asc" } },
    },
  });
  if (!o) return null;
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    createdLabel: formatDate(o.createdAt, { time: true }),
    updatedLabel: formatDate(o.updatedAt, { time: true }),
    totalLabel: formatMoney(o.total, currency),
    deliveryAddress: o.deliveryAddress,
    notes: o.notes,
    channelLabel: o.conversation ? CHANNEL_LABEL[o.conversation.channel.type] ?? null : null,
    conversationId: o.conversation?.id ?? null,
    customer: {
      name: o.customer.name,
      phone: customerPhone(o.customer, o.conversation?.channel.type),
    },
    items: o.items.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPriceLabel: formatMoney(i.unitPrice, currency),
      subtotalLabel: formatMoney(i.unitPrice.mul(i.quantity), currency),
      removed: i.productId === null,
    })),
  };
}
