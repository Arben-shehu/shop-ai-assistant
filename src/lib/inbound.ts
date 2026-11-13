import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { InboundMessage } from "@/lib/channels/types";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/events";
import { notify } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { getShopSettings } from "@/lib/shop-settings";
import { sendToCustomer } from "@/lib/outbound";
import { generateReply } from "@/lib/ai/assistant";

const MAX_TEXT = 4000;

/**
 * CONTRACT (owned by the AI agent): called by every webhook after verifying + normalising a message.
 * Must: find Channel by (type, externalId) -> upsert Customer -> upsert Conversation -> save Message
 * (drop duplicates by externalId) -> publish live events -> if conversation.mode === "AI" and shop aiEnabled,
 * generate a reply and send it with sendToCustomer(). Must never throw to the webhook (log instead).
 *
 * Resolves after the AI reply was handed to sendToCustomer (several seconds). Webhook routes should call it
 * inside `after()` so the provider gets its 200 immediately.
 */
export async function handleInbound(msg: InboundMessage): Promise<void> {
  try {
    const saved = await saveInbound(msg);
    if (!saved) return;
    const { orgId, conversationId, messageId } = saved;

    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: orgId }, select: { mode: true } });
    if (conv?.mode !== "AI") return;
    const { aiEnabled } = await getShopSettings(orgId);
    if (!aiEnabled) return;

    await enqueueReply(orgId, conversationId, messageId);
  } catch (e) {
    console.error("[inbound] failed to handle message", { channel: msg.channelType, messageId: msg.messageId }, e);
  }
}

/** Steps 1-4. Returns null for unknown channels, empty payloads and duplicate deliveries. */
async function saveInbound(msg: InboundMessage) {
  const customerExternalId = msg.customerExternalId?.trim();
  const messageId = msg.messageId?.trim();
  const text = msg.text?.trim() ? msg.text.trim().slice(0, MAX_TEXT) : null;
  const mediaUrl = msg.mediaUrl?.trim() || null;
  if (!customerExternalId || !messageId || (!text && !mediaUrl)) {
    console.warn("[inbound] dropping message without customer id, message id or content", { channel: msg.channelType });
    return null;
  }

  const channel = await prisma.channel.findUnique({
    where: { type_externalId: { type: msg.channelType, externalId: msg.channelExternalId } },
    select: { id: true, organizationId: true, isActive: true, type: true },
  });
  if (!channel || !channel.isActive) {
    console.warn("[inbound] no active channel for", msg.channelType, msg.channelExternalId);
    return null;
  }
  const orgId = channel.organizationId;
  const isWhatsApp = channel.type === "WHATSAPP_OPENWA" || channel.type === "WHATSAPP_META";
  const name = msg.customerName?.trim().slice(0, 100) || null;

  let customer = await retryOnUniqueRace(() =>
    prisma.customer.upsert({
      where: { organizationId_externalId: { organizationId: orgId, externalId: customerExternalId } },
      create: { organizationId: orgId, externalId: customerExternalId, name, phone: isWhatsApp ? customerExternalId : null },
      update: {},
      select: { id: true, name: true },
    }),
  );
  if (!customer.name && name) {
    customer = await prisma.customer.update({ where: { id: customer.id }, data: { name }, select: { id: true, name: true } });
  }

  let conversation = await retryOnUniqueRace(() =>
    prisma.conversation.upsert({
      where: { channelId_customerId: { channelId: channel.id, customerId: customer.id } },
      create: { organizationId: orgId, channelId: channel.id, customerId: customer.id },
      update: {},
      select: { id: true, mode: true },
    }),
  );
  if (conversation.mode === "CLOSED") {
    conversation = await prisma.conversation.update({ where: { id: conversation.id }, data: { mode: "AI" }, select: { id: true, mode: true } });
    await logActivity({ orgId, action: "conversation.reopened", entityType: "conversation", entityId: conversation.id });
  }

  let saved;
  try {
    saved = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        sender: "CUSTOMER",
        text,
        mediaUrl,
        mediaType: mediaUrl ? msg.mediaType?.slice(0, 100) || null : null,
        externalId: messageId,
      },
      select: { id: true, createdAt: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return null; // duplicate webhook delivery
    throw e;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { unreadCount: { increment: 1 }, lastMessageAt: saved.createdAt },
  });
  publish(orgId, { type: "message", conversationId: conversation.id });
  publish(orgId, { type: "conversation", conversationId: conversation.id });
  return { orgId, conversationId: conversation.id, messageId: saved.id };
}

// ---------------------------------------------------------------------------------------------------------------
// Per-conversation reply queue.
// shortcut: in-process promise chain — serialises replies only within a single Node instance. With >1 instance,
// move to a DB-backed job (e.g. SELECT ... FOR UPDATE SKIP LOCKED on a reply-jobs table) or a pg advisory lock.
// ---------------------------------------------------------------------------------------------------------------

type ReplyQueue = { tail: Promise<void>; pending: Set<string>; answered: Set<string> };
const g = globalThis as unknown as { aiReplyQueues?: Map<string, ReplyQueue> };
const queues = (g.aiReplyQueues ??= new Map());

function enqueueReply(orgId: string, conversationId: string, messageId: string): Promise<void> {
  let q = queues.get(conversationId);
  if (!q) {
    q = { tail: Promise.resolve(), pending: new Set(), answered: new Set() };
    queues.set(conversationId, q);
  }
  const queue = q;
  queue.pending.add(messageId);
  const job = () => replyJob(orgId, conversationId, messageId, queue);
  const next = queue.tail.then(job, job);
  queue.tail = next;
  void next.finally(() => {
    if (queue.tail === next) queues.delete(conversationId);
  });
  return next;
}

async function replyJob(orgId: string, conversationId: string, messageId: string, q: ReplyQueue): Promise<void> {
  if (q.answered.has(messageId)) return; // an earlier reply already covered this message
  try {
    // Re-check: an operator may have taken over (or AI was disabled) while this job waited.
    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: orgId }, select: { mode: true } });
    if (conv?.mode !== "AI" || !(await getShopSettings(orgId)).aiEnabled) return;

    const answerIds = [...q.pending].filter((id) => !q.answered.has(id));
    const reply = await generateReply({ orgId, conversationId, answerIds });
    for (const id of [...reply.answeredIds, messageId]) {
      q.answered.add(id);
      q.pending.delete(id);
    }
    if (!reply.text) return;

    if (!reply.handedOff) {
      // An operator may have taken over during generation: then stay silent.
      const now = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: orgId }, select: { mode: true } });
      if (now?.mode !== "AI") return;
    }
    const sent = await sendToCustomer(conversationId, reply.text, { sender: "AI" });
    if (!sent.ok) console.warn("[inbound] AI reply saved as FAILED (channel inactive)", { conversationId, messageId: sent.messageId });
  } catch (e) {
    q.pending.delete(messageId);
    await failToHuman(orgId, conversationId, e);
  }
}

/** Any AI failure: a person must answer. Never throws. */
async function failToHuman(orgId: string, conversationId: string, error: unknown) {
  console.error("[inbound] AI reply failed, handing conversation to a human", { conversationId }, error);
  try {
    const { count } = await prisma.conversation.updateMany({
      where: { id: conversationId, organizationId: orgId, mode: "AI" },
      data: { mode: "HUMAN" },
    });
    if (count === 0) return; // already HUMAN/CLOSED — someone is on it
    publish(orgId, { type: "conversation", conversationId });
    await notify(orgId, {
      type: "HUMAN_NEEDED",
      title: "AI could not answer a customer",
      body: "The assistant hit an error; the conversation was switched to a human.",
      link: `/conversations/${conversationId}`,
    });
    await logActivity({
      orgId,
      action: "conversation.handoff",
      entityType: "conversation",
      entityId: conversationId,
      meta: { by: "system", reason: error instanceof Error ? error.message.slice(0, 300) : "unknown error" },
    });
  } catch (e) {
    console.error("[inbound] failed to hand off conversation", { conversationId }, e);
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Two first messages from the same new customer can race on the upsert's INSERT; the retry finds the row. */
async function retryOnUniqueRace<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isUniqueViolation(e)) return fn();
    throw e;
  }
}
