"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ConversationMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrg } from "@/lib/session";
import { publish } from "@/lib/events";
import { logActivity } from "@/lib/activity";
import { sendToCustomer } from "@/lib/outbound";

export type ActionResult = { ok: true } | { ok: false; error: string };

const idSchema = z.string().min(1).max(64);
const INVALID: ActionResult = { ok: false, error: "Të dhëna të pavlefshme." };
const NOT_FOUND: ActionResult = { ok: false, error: "Biseda nuk u gjet." };

function refresh(orgId: string, conversationId: string) {
  revalidatePath("/conversations", "layout");
  publish(orgId, { type: "conversation", conversationId });
}

async function setMode(rawId: unknown, mode: ConversationMode, action: string): Promise<ActionResult> {
  const { orgId, user } = await requireOrg();
  const id = idSchema.safeParse(rawId);
  if (!id.success) return INVALID;

  const { count } = await prisma.conversation.updateMany({
    where: { id: id.data, organizationId: orgId },
    data: { mode, assigneeId: mode === "HUMAN" ? user.id : null },
  });
  if (count === 0) return NOT_FOUND;

  await logActivity({ orgId, userId: user.id, action, entityType: "conversation", entityId: id.data });
  refresh(orgId, id.data);
  return { ok: true };
}

/** Operator takes over: the AI goes silent and the conversation is assigned to the caller. */
export async function takeOverConversation(id: string) {
  return setMode(id, "HUMAN", "conversation.taken_over");
}

/** Hand the conversation back to the AI assistant. */
export async function returnToAi(id: string) {
  return setMode(id, "AI", "conversation.returned_to_ai");
}

export async function closeConversation(id: string) {
  return setMode(id, "CLOSED", "conversation.closed");
}

/** Clear the unread counter (called when an operator has the thread open). */
export async function markConversationRead(rawId: string): Promise<ActionResult> {
  const { orgId } = await requireOrg();
  const id = idSchema.safeParse(rawId);
  if (!id.success) return INVALID;
  const { count } = await prisma.conversation.updateMany({
    where: { id: id.data, organizationId: orgId, unreadCount: { gt: 0 } },
    data: { unreadCount: 0 },
  });
  if (count > 0) refresh(orgId, id.data);
  return { ok: true };
}

const sendSchema = z.object({ conversationId: idSchema, text: z.string().trim().min(1).max(4000) });

/** Operator reply. Only allowed while the conversation is in HUMAN mode. */
export async function sendOperatorMessage(input: z.input<typeof sendSchema>): Promise<ActionResult> {
  const { orgId, user } = await requireOrg();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Shkruani një mesazh (deri në 4000 shkronja)." };
  const { conversationId, text } = parsed.data;

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: orgId },
    select: { mode: true },
  });
  if (!conversation) return NOT_FOUND;
  if (conversation.mode !== "HUMAN") return { ok: false, error: "Merrni bisedën përpara se t'i shkruani klientit." };

  try {
    const res = await sendToCustomer(conversationId, text, { sender: "OPERATOR", operatorId: user.id });
    revalidatePath("/conversations", "layout");
    if (!res.ok) return { ok: false, error: "Mesazhi nuk u dërgua. Shihni gabimin në bisedë." };
  } catch (e) {
    console.error("sendOperatorMessage failed", e);
    return { ok: false, error: "Mesazhi nuk u dërgua. Kanali nuk është i disponueshëm për momentin." };
  }
  await logActivity({ orgId, userId: user.id, action: "conversation.operator_replied", entityType: "conversation", entityId: conversationId });
  return { ok: true };
}

const customerSchema = z.object({
  customerId: idSchema,
  name: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(500),
});

export async function updateCustomer(input: z.input<typeof customerSchema>): Promise<ActionResult> {
  const { orgId, user } = await requireOrg();
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const { customerId, ...fields } = parsed.data;

  const { count } = await prisma.customer.updateMany({
    where: { id: customerId, organizationId: orgId },
    data: { name: fields.name || null, phone: fields.phone || null, address: fields.address || null },
  });
  if (count === 0) return { ok: false, error: "Klienti nuk u gjet." };

  await logActivity({ orgId, userId: user.id, action: "customer.updated", entityType: "customer", entityId: customerId, meta: fields });
  revalidatePath("/conversations", "layout");
  const conversations = await prisma.conversation.findMany({ where: { customerId, organizationId: orgId }, select: { id: true } });
  for (const c of conversations) publish(orgId, { type: "conversation", conversationId: c.id });
  return { ok: true };
}
