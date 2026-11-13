import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const MODE_FILTERS = ["all", "AI", "HUMAN", "CLOSED"] as const;
export type ModeFilter = (typeof MODE_FILTERS)[number];

const filtersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  mode: z.enum(MODE_FILTERS).catch("all"),
});
export type InboxFilters = z.infer<typeof filtersSchema>;

/** Parse ?q=&mode= safely (arrays / junk fall back to defaults). */
export function parseFilters(sp: Record<string, string | string[] | undefined>): InboxFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return filtersSchema.parse({ q: first(sp.q) ?? "", mode: first(sp.mode) ?? "all" });
}

/** Query string that keeps the inbox filters when moving between list and thread. */
export function filtersQuery({ q, mode }: InboxFilters) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (mode !== "all") p.set("mode", mode);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const LIST_LIMIT = 100;

export async function listConversations(orgId: string, { q, mode }: InboxFilters) {
  const where: Prisma.ConversationWhereInput = { organizationId: orgId };
  if (mode !== "all") where.mode = mode;
  if (q) {
    // phone search ignores formatting and a local leading 0 ("067 345…" matches 35567345…)
    const digits = q.replace(/\D/g, "").replace(/^0+/, "");
    where.customer = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ externalId: { contains: digits } }] : []),
      ],
    };
  }
  return prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      mode: true,
      unreadCount: true,
      lastMessageAt: true,
      channel: { select: { type: true } },
      customer: { select: { name: true, phone: true, externalId: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { text: true, mediaUrl: true, sender: true },
      },
    },
  });
}
export type ConversationListItem = Awaited<ReturnType<typeof listConversations>>[number];

export const THREAD_LIMIT = 200;

/** Conversation of this org with its latest messages (oldest first), or null. */
export async function getThread(orgId: string, id: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      mode: true,
      unreadCount: true,
      assigneeId: true,
      assignee: { select: { name: true } },
      channel: { select: { type: true, name: true } },
      customer: { select: { id: true, name: true, phone: true, address: true, externalId: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: THREAD_LIMIT,
        select: {
          id: true,
          sender: true,
          direction: true,
          text: true,
          mediaUrl: true,
          mediaType: true,
          status: true,
          error: true,
          createdAt: true,
          operator: { select: { name: true } },
        },
      },
    },
  });
  if (!conversation) return null;
  const orders = await prisma.order.findMany({
    where: { organizationId: orgId, customerId: conversation.customer.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, number: true, status: true, total: true, createdAt: true },
  });
  return { ...conversation, messages: conversation.messages.reverse(), orders };
}
export type Thread = NonNullable<Awaited<ReturnType<typeof getThread>>>;
export type ThreadMessage = Thread["messages"][number];
