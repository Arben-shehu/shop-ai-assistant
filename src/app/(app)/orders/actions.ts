"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { setOrderStatus } from "@/lib/orders";
import { requireOrg } from "@/lib/session";
import { publish } from "@/lib/events";
import { logActivity } from "@/lib/activity";
import { STATUS_LABEL } from "@/components/orders/order-status";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const statusInput = z.object({ orderId: z.string().min(1).max(64), status: z.enum(OrderStatus) });

/** Any shop member. Cancelling a not-yet-delivered order puts its items back in stock (same transaction). */
export async function updateOrderStatus(input: z.input<typeof statusInput>): Promise<ActionResult> {
  const { orgId, user } = await requireOrg();
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Të dhëna të pavlefshme." };
  const { orderId, status } = parsed.data;

  const res = await setOrderStatus(orgId, orderId, status, { userId: user.id });
  if (!res.ok) {
    switch (res.code) {
      case "NOT_FOUND":
        return { ok: false, error: "Porosia nuk u gjet." };
      case "ALREADY_CANCELLED":
        return { ok: false, error: "Porosia është anuluar tashmë." };
      case "BAD_TRANSITION":
        return { ok: false, error: `Statusi nuk mund të ndryshohet nga "${STATUS_LABEL[res.from!]}" në "${STATUS_LABEL[status]}".` };
      case "CHANGED":
        return { ok: false, error: "Porosia u ndryshua nga dikush tjetër. Rifreskoni faqen." };
    }
  }
  revalidatePath("/orders");
  if (res.restocked) revalidatePath("/stock");
  return {
    ok: true,
    message: res.restocked ? "Porosia u anulua dhe stoku u rikthye." : `Statusi u ndryshua në "${STATUS_LABEL[status]}".`,
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
