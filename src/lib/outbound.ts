import "server-only";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/events";
import { maxTextLength } from "@/lib/channels";
import { splitMessage } from "@/lib/channels/phone";
import { kickOutbox } from "@/lib/channels/outbox";
import { ensureChannelWorkers } from "@/lib/channels/workers";

const DEDUPE_WINDOW_MS = 60_000;

/**
 * CONTRACT (owned by the channels agent): queue a text for the conversation's customer (outbox pattern).
 * Creates the OUTBOUND Message(s) with status QUEUED (sender AI or OPERATOR + operatorId), bumps
 * Conversation.lastMessageAt, publishes { type: "message" } and wakes the outbox worker, which delivers
 * them in the background (src/lib/channels/outbox.ts: retries 1/5/25 min, then status FAILED + `error`).
 * - Texts over the channel limit are split into numbered parts (one Message per part; first id returned).
 * - The identical text to the same conversation within 60 s is not queued twice (the earlier id is returned).
 * - Inactive channel: the message is saved as FAILED and ok is false.
 * Returns { messageId, ok: true } once queued — delivery status lives on Message.status.
 * Throws only on an invalid conversation or empty text.
 */
export async function sendToCustomer(
  conversationId: string,
  text: string,
  from: { sender: "AI" } | { sender: "OPERATOR"; operatorId: string },
): Promise<{ messageId: string; ok: boolean }> {
  const body = text.trim();
  if (!body) throw new Error("sendToCustomer: empty text");
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, organizationId: true, channel: { select: { type: true, isActive: true } } },
  });
  if (!conv) throw new Error(`sendToCustomer: conversation ${conversationId} not found`);

  const parts = splitMessage(body, maxTextLength[conv.channel.type]);
  const dup = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "OUTBOUND",
      text: parts[0],
      status: { not: "FAILED" },
      createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (dup) return { messageId: dup.id, ok: true };

  const active = conv.channel.isActive;
  const operatorId = from.sender === "OPERATOR" ? from.operatorId : null;
  const now = Date.now();
  const ids = await prisma.$transaction(async (tx) => {
    const created: string[] = [];
    for (const [i, part] of parts.entries()) {
      const m = await tx.message.create({
        data: {
          conversationId,
          direction: "OUTBOUND",
          sender: from.sender,
          operatorId,
          text: part,
          status: active ? "QUEUED" : "FAILED",
          error: active ? null : "Kanali është i çaktivizuar",
          nextAttemptAt: active ? new Date(now) : null,
          createdAt: new Date(now + i), // keeps the parts ordered
        },
        select: { id: true },
      });
      created.push(m.id);
    }
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(now) } });
    return created;
  });

  publish(conv.organizationId, { type: "message", conversationId });
  if (active) {
    ensureChannelWorkers();
    kickOutbox();
  }
  return { messageId: ids[0], ok: active };
}
