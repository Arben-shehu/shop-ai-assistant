"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireOrg } from "@/lib/session";
import { publish } from "@/lib/events";
import { logActivity } from "@/lib/activity";
import { canTransition, STATUS_LABEL } from "@/components/orders/order-status";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const statusInput = z.object({ orderId: z.string().min(1).max(64), status: z.enum(OrderStatus) });

class ActionError extends Error {}

/** Any shop member. Cancelling a not-yet-delivered order puts its items back in stock (same transaction). */
export async function updateOrderStatus(input: z.input<typeof statusInput>): Promise<ActionResult> {
  const { orgId, user } = await requireOrg();
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Të dhëna të pavlefshme." };
  const { orderId, status } = parsed.data;

  let from: OrderStatus;
  let restocked = false;
  try {
    ({ from, restocked } = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, organizationId: orgId },
        select: { status: true, items: { select: { productId: true, quantity: true } } },
      });
      if (!order) throw new ActionError("Porosia nuk u gjet.");
      if (order.status === "CANCELLED") throw new ActionError("Porosia është anuluar tashmë.");
      if (!canTransition(order.status, status))
        throw new ActionError(`Statusi nuk mund të ndryshohet nga "${STATUS_LABEL[order.status]}" në "${STATUS_LABEL[status]}".`);

      // Conditional on the status we read: a double submit can't apply (or restock) twice.
      const res = await tx.order.updateMany({
        where: { id: orderId, organizationId: orgId, status: order.status },
        data: { status },
      });
      if (res.count !== 1) throw new ActionError("Porosia u ndryshua nga dikush tjetër. Rifreskoni faqen.");

      const restock = status === "CANCELLED" && order.status !== "DELIVERED";
      if (restock) {
        for (const item of order.items) {
          if (!item.productId) continue;
          await tx.product.updateMany({
            where: { id: item.productId, organizationId: orgId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
      return { from: order.status, restocked: restock };
    }));
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    throw e;
  }

  publish(orgId, { type: "order", orderId });
  await logActivity({
    orgId,
    userId: user.id,
    action: "order.status_changed",
    entityType: "order",
    entityId: orderId,
    meta: { from, to: status, restocked },
  });
  revalidatePath("/orders");
  if (restocked) revalidatePath("/stock");
  return {
    ok: true,
    message: restocked ? "Porosia u anulua dhe stoku u rikthye." : `Statusi u ndryshua në "${STATUS_LABEL[status]}".`,
  };
}

const notesInput = z.object({ orderId: z.string().min(1).max(64), notes: z.string().max(2000) });

/** Any shop member. */
export async function updateOrderNotes(input: z.input<typeof notesInput>): Promise<ActionResult> {
  const { orgId, user } = await requireOrg();
  const parsed = notesInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Shënimet janë shumë të gjata (maks. 2000 karaktere)." };
  const { orderId } = parsed.data;
  const notes = parsed.data.notes.trim() || null;

  const res = await prisma.order.updateMany({ where: { id: orderId, organizationId: orgId }, data: { notes } });
  if (res.count !== 1) return { ok: false, error: "Porosia nuk u gjet." };

  publish(orgId, { type: "order", orderId });
  await logActivity({ orgId, userId: user.id, action: "order.notes_updated", entityType: "order", entityId: orderId });
  revalidatePath("/orders");
  return { ok: true, message: "Shënimet u ruajtën." };
}
