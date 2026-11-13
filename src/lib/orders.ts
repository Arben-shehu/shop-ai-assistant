import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { publish } from "@/lib/events";
import { logActivity } from "@/lib/activity";
import { getShopSettings } from "@/lib/shop-settings";
import { canTransition } from "@/components/orders/order-status";

export const MAX_ORDER_LINES = 20;
export const MAX_LINE_QUANTITY = 100;
/** The same customer confirming the same lines again within this window gets the existing order back. */
export const DUPLICATE_WINDOW_MS = 30 * 60_000;

export type CreateOrderInput = {
  customerId: string;
  conversationId?: string | null;
  items: { productId: string; quantity: number }[];
  deliveryAddress?: string | null;
  notes?: string | null;
};

export type CreatedOrder = {
  id: string;
  number: number;
  /** Decimal as string with 2 decimals, e.g. "1999.98". */
  total: string;
  items: { productId: string; name: string; quantity: number; unitPrice: string; lineTotal: string }[];
  deliveryAddress: string | null;
};

export type CreateOrderError =
  | { code: "INVALID_INPUT"; message: string }
  | { code: "CUSTOMER_NOT_FOUND" }
  | { code: "PRODUCT_NOT_FOUND"; productIds: string[] }
  | { code: "OUT_OF_STOCK"; items: { productId: string; name: string; requested: number; available: number }[] }
  | { code: "DUPLICATE"; orderId: string; number: number; total: string };

export type CreateOrderResult = { ok: true; order: CreatedOrder } | { ok: false; error: CreateOrderError };

/** Thrown inside the transaction so every stock decrement made so far is rolled back. */
class OrderAbort extends Error {
  constructor(readonly error: CreateOrderError) {
    super(error.code);
  }
}

/**
 * Create an order for a shop in one transaction: products are re-read scoped to orgId, stock is decremented with a
 * conditional UPDATE (`stock >= qty`) so concurrent orders cannot oversell, name/price are snapshotted, total uses Decimal.
 * Never trusts ids from the caller: product, customer and conversation must all belong to orgId.
 */
export async function createOrder(orgId: string, input: CreateOrderInput): Promise<CreateOrderResult> {
  // Merge duplicate lines and validate quantities.
  const qty = new Map<string, number>();
  for (const it of input.items) {
    if (typeof it.productId !== "string" || !it.productId) return invalid("productId is required");
    if (!Number.isInteger(it.quantity) || it.quantity < 1) return invalid("quantity must be a positive integer");
    qty.set(it.productId, (qty.get(it.productId) ?? 0) + it.quantity);
  }
  if (qty.size === 0) return invalid("an order needs at least one item");
  if (qty.size > MAX_ORDER_LINES) return invalid(`at most ${MAX_ORDER_LINES} different products per order`);
  for (const q of qty.values()) if (q > MAX_LINE_QUANTITY) return invalid(`at most ${MAX_LINE_QUANTITY} units per product`);

  const productIds = [...qty.keys()];
  const itemsHash = hashItems(qty);
  let order: CreatedOrder;
  let customerName: string | null = null;
  try {
    order = await prisma.$transaction(async (tx) => {
      // Serialise order creation per customer so two deliveries of the same confirmation cannot both pass the check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.customerId}))`;
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: orgId },
        select: { id: true, name: true, address: true },
      });
      if (!customer) throw new OrderAbort({ code: "CUSTOMER_NOT_FOUND" });
      customerName = customer.name;

      const same = await tx.order.findFirst({
        where: {
          organizationId: orgId,
          customerId: customer.id,
          itemsHash,
          status: { not: "CANCELLED" },
          createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, number: true, total: true },
      });
      if (same) throw new OrderAbort({ code: "DUPLICATE", orderId: same.id, number: same.number, total: same.total.toFixed(2) });

      let conversationId: string | null = null;
      if (input.conversationId) {
        const conv = await tx.conversation.findFirst({
          where: { id: input.conversationId, organizationId: orgId, customerId: customer.id },
          select: { id: true },
        });
        conversationId = conv?.id ?? null;
      }

      const products = await tx.product.findMany({
        where: { id: { in: productIds }, organizationId: orgId, isActive: true },
        select: { id: true, name: true, price: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      const missing = productIds.filter((id) => !byId.has(id));
      if (missing.length) throw new OrderAbort({ code: "PRODUCT_NOT_FOUND", productIds: missing });

      // Decrement in a stable order (sorted ids) so two multi-item orders lock rows in the same order — no deadlocks.
      const short: { productId: string; name: string; requested: number; available: number }[] = [];
      for (const id of [...productIds].sort()) {
        const requested = qty.get(id)!;
        const { count } = await tx.product.updateMany({
          where: { id, organizationId: orgId, isActive: true, stock: { gte: requested } },
          data: { stock: { decrement: requested } },
        });
        if (count === 0) {
          const now = await tx.product.findFirst({ where: { id, organizationId: orgId }, select: { stock: true } });
          short.push({ productId: id, name: byId.get(id)!.name, requested, available: Math.max(0, now?.stock ?? 0) });
        }
      }
      if (short.length) throw new OrderAbort({ code: "OUT_OF_STOCK", items: short });

      let total = new Prisma.Decimal(0);
      const lines = productIds.map((id) => {
        const p = byId.get(id)!;
        const quantity = qty.get(id)!;
        const unitPrice = new Prisma.Decimal(p.price);
        const lineTotal = unitPrice.mul(quantity);
        total = total.add(lineTotal);
        return { productId: id, name: p.name, quantity, unitPrice, lineTotal };
      });

      const created = await tx.order.create({
        data: {
          organizationId: orgId,
          customerId: customer.id,
          conversationId,
          total,
          deliveryAddress: clean(input.deliveryAddress, 500) ?? customer.address ?? null,
          notes: clean(input.notes, 1000),
          itemsHash,
          items: {
            create: lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice })),
          },
        },
        select: { id: true, number: true, total: true, deliveryAddress: true },
      });

      return {
        id: created.id,
        number: created.number,
        total: created.total.toFixed(2),
        deliveryAddress: created.deliveryAddress,
        items: lines.map((l) => ({
          productId: l.productId,
          name: l.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
        })),
      };
    });
  } catch (e) {
    if (e instanceof OrderAbort) return { ok: false, error: e.error };
    throw e;
  }

  // Post-commit side effects: never turn a committed order into a reported failure.
  try {
    const { currency } = await getShopSettings(orgId);
    await notify(orgId, {
      type: "NEW_ORDER",
      title: `New order #${order.number}`,
      body: `${customerName ?? "Customer"} — ${order.total} ${currency} (${order.items.length} item${order.items.length === 1 ? "" : "s"})`,
      link: "/orders",
    });
  } catch (e) {
    console.error("[orders] notify failed", e);
  }
  publish(orgId, { type: "order", orderId: order.id });
  await logActivity({
    orgId,
    action: "order.created",
    entityType: "order",
    entityId: order.id,
    meta: { number: order.number, total: order.total, items: order.items.length, conversationId: input.conversationId ?? null },
  });

  return { ok: true, order };
}

/** sha256 of the merged lines, sorted: "productId:qty" joined by newlines. */
export function hashItems(qty: Map<string, number>): string {
  const lines = [...qty].map(([id, q]) => `${id}:${q}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export type StatusChangeResult =
  | { ok: true; from: OrderStatus; restocked: boolean }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_CANCELLED" | "BAD_TRANSITION" | "CHANGED"; from?: OrderStatus };

/**
 * Change an order's status in one transaction: conditional on the status read (a double submit cannot apply or restock
 * twice); cancelling a not-yet-delivered order puts its items back in stock. Publishes the live event and logs activity.
 * `anyStep` lets the ERP sync jump forward (PENDING -> DELIVERED) or move to any status; staff use single steps.
 */
export async function setOrderStatus(
  orgId: string,
  orderId: string,
  to: OrderStatus,
  opts: { userId?: string | null; anyStep?: boolean; data?: Prisma.OrderUpdateManyMutationInput; meta?: Record<string, string | null> } = {},
): Promise<StatusChangeResult> {
  let res: StatusChangeResult;
  try {
    res = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, organizationId: orgId },
        select: { status: true, items: { select: { productId: true, quantity: true } } },
      });
      if (!order) return { ok: false, code: "NOT_FOUND" } as const;
      if (order.status === "CANCELLED") return { ok: false, code: "ALREADY_CANCELLED", from: order.status } as const;
      if (order.status === to || (!opts.anyStep && !canTransition(order.status, to))) {
        return { ok: false, code: "BAD_TRANSITION", from: order.status } as const;
      }
      const updated = await tx.order.updateMany({
        where: { id: orderId, organizationId: orgId, status: order.status },
        data: { ...opts.data, status: to },
      });
      if (updated.count !== 1) throw new OrderAbort({ code: "INVALID_INPUT", message: "changed" });
      const restocked = to === "CANCELLED" && order.status !== "DELIVERED";
      if (restocked) {
        for (const item of order.items) {
          if (!item.productId) continue;
          await tx.product.updateMany({ where: { id: item.productId, organizationId: orgId }, data: { stock: { increment: item.quantity } } });
        }
      }
      return { ok: true, from: order.status, restocked } as const;
    });
  } catch (e) {
    if (e instanceof OrderAbort) return { ok: false, code: "CHANGED" };
    throw e;
  }
  if (!res.ok) return res;
  publish(orgId, { type: "order", orderId });
  await logActivity({
    orgId,
    userId: opts.userId ?? null,
    action: "order.status_changed",
    entityType: "order",
    entityId: orderId,
    meta: { from: res.from, to, restocked: res.restocked, ...opts.meta },
  });
  return res;
}

function invalid(message: string): CreateOrderResult {
  return { ok: false, error: { code: "INVALID_INPUT", message } };
}

function clean(s: string | null | undefined, max: number): string | null {
  const t = s?.trim();
  return t ? t.slice(0, max) : null;
}
