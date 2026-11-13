import "server-only";
import { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { setOrderStatus } from "@/lib/orders";
import { readOrderStatuses, recordSourceError } from "@/lib/inventory/source";
import { orderRef } from "@/components/orders/order-status";

/**
 * Order status read back from the shop's ERP. Staff type our order into their system with the reference AI-<number>;
 * every 5 min, for shops with an orderStatusQuery, up to 50 open orders of the last 30 days (least recently synced
 * first) are looked up by that reference. A returned `status` that is one of ours and differs from ours is applied
 * (optional `external_status` column = their wording, shown to staff)
 * (same helper as the orders page: conditional update, restock on cancel, live event, activity log).
 * Not found: only syncedAt. Their DB failing: lastError on the source, the worker carries on.
 */

const EVERY_MS = 5 * 60_000;
const STARTUP_DELAY_MS = 45_000;
const BATCH = 50;
const WINDOW_MS = 30 * 24 * 60 * 60_000;
const OPEN: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING"];

type SyncState = { started: boolean; running: boolean; tick?: () => Promise<void> };
const g = globalThis as unknown as { shopStatusSync?: SyncState };
const state = (g.shopStatusSync ??= { started: false, running: false });

/** Idempotent: one loop per process. The interval calls through state.tick so dev hot reloads take effect. */
export function startOrderStatusSync() {
  state.tick = syncAllOrderStatuses;
  if (state.started) return;
  state.started = true;
  const safe = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await state.tick?.();
    } catch (e) {
      console.error("[status-sync]", e instanceof Error ? e.message : e);
    } finally {
      state.running = false;
    }
  };
  setTimeout(() => {
    void safe();
    setInterval(() => void safe(), EVERY_MS).unref?.();
  }, STARTUP_DELAY_MS).unref?.();
  console.log("[status-sync] started (every 5 min)");
}

export async function syncAllOrderStatuses() {
  const sources = await prisma.inventorySource.findMany({
    where: { isActive: true, orderStatusQuery: { not: null } },
    select: { organizationId: true },
  });
  for (const s of sources) await syncOrgOrderStatuses(s.organizationId);
}

export type SyncSummary = { checked: number; updated: number; failed: boolean };

/** One org. Never throws for their DB; our own DB errors propagate to the loop's catch. */
export async function syncOrgOrderStatuses(orgId: string): Promise<SyncSummary> {
  const src = await prisma.inventorySource.findFirst({
    where: { organizationId: orgId, isActive: true, orderStatusQuery: { not: null } },
    select: { id: true, dialect: true, url: true, orderStatusQuery: true },
  });
  if (!src?.orderStatusQuery) return { checked: 0, updated: 0, failed: false };
  const orders = await prisma.order.findMany({
    where: { organizationId: orgId, status: { in: OPEN }, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
    orderBy: [{ syncedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: BATCH,
    select: { id: true, number: true, status: true, externalStatus: true },
  });
  if (!orders.length) return { checked: 0, updated: 0, failed: false };

  let rows;
  try {
    rows = await readOrderStatuses({ ...src, orderStatusQuery: src.orderStatusQuery }, orders.map((o) => orderRef(o.number)));
  } catch (e) {
    await recordSourceError(src.id, e);
    return { checked: 0, updated: 0, failed: true };
  }

  let updated = 0;
  const now = new Date();
  for (const o of orders) {
    const ref = orderRef(o.number);
    const row = rows.get(ref);
    const raw = row?.status;
    if (!row || raw === null || raw === undefined || String(raw).trim() === "") {
      await prisma.order.updateMany({ where: { id: o.id, organizationId: orgId }, data: { syncedAt: now } });
      continue;
    }
    const status = String(raw).trim().toUpperCase();
    // Their own wording when the query also returns it (e.g. "konfirmuar"), else the status as returned.
    const external = String(row.external_status ?? raw).trim().slice(0, 100);
    if (Object.hasOwn(OrderStatus, status) && status !== o.status) {
      const res = await setOrderStatus(orgId, o.id, status as OrderStatus, {
        anyStep: true,
        data: { externalStatus: external, syncedAt: now },
        meta: { by: "erp", ref, externalStatus: external },
      });
      if (res.ok) {
        updated++;
        continue;
      }
    }
    // Same status, not one of ours (the admin should map it in SQL), or changed meanwhile: just record what we read.
    await prisma.order.updateMany({ where: { id: o.id, organizationId: orgId }, data: { externalStatus: external, syncedAt: now } });
  }
  return { checked: orders.length, updated, failed: false };
}
