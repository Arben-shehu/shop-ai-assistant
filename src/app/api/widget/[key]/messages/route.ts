import { randomUUID } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleInbound } from "@/lib/inbound";
import type { InboundMessage } from "@/lib/channels/types";
import { verifyVisitorToken, visitorExternalId, WEB_MAX_INBOUND } from "@/lib/channels/web";
import { ensureChannelWorkers } from "@/lib/channels/workers";
import { bearer, ipRateLimit, json, LIMITS, preflight, rateLimit, readJson, widgetContext } from "@/lib/widget-api";

/**
 * Visitor side of a web chat conversation. Auth: `Authorization: Bearer <visitor token>` from POST .../session.
 *
 * GET  /api/widget/{key}/messages?after=<ISO cursor>
 *   -> { messages: [{ id, ref?, sender, text, createdAt }], cursor, typing, shop }
 *   Only the visitor's own INBOUND messages and OUTBOUND messages that reached SENT. Without `after`: the latest 50.
 *   An OUTBOUND row becomes visible (SENT) after its createdAt, so while an older reply is still QUEUED/SENDING the
 *   cursor is held back before it; the widget dedupes by id.
 * POST /api/widget/{key}/messages { text } -> 202 { ok, ref }
 *   Saved + answered by handleInbound() in after(). `ref` matches the `ref` of the visitor's message in GET.
 */

type Ctx = { params: Promise<{ key: string }> };

const PAGE = 50;
const TYPING_WINDOW_MS = 90_000;
const DAY_MS = 86_400_000;

export async function OPTIONS(req: NextRequest, { params }: Ctx) {
  return preflight(req, (await params).key);
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await widgetContext(req, (await params).key);
  if (!ctx.ok) return ctx.res;
  const { channel, headers } = ctx;
  if (!ipRateLimit(req, "poll", LIMITS.pollsPerIpPerMin, 60_000)) {
    return json({ error: "rate_limited" }, 429, { ...headers, "Retry-After": "30" });
  }
  const token = bearer(req);
  if (!token || !verifyVisitorToken(channel.id, token)) return json({ error: "invalid_token" }, 401, headers);

  const afterParam = req.nextUrl.searchParams.get("after");
  const after = afterParam ? new Date(afterParam) : null;
  if (after && Number.isNaN(after.getTime())) return json({ error: "bad_cursor" }, 400, headers);

  const empty = () => json({ messages: [], cursor: afterParam, typing: false, shop: channel.shopName }, 200, headers);
  const customer = await prisma.customer.findUnique({
    where: { organizationId_externalId: { organizationId: channel.organizationId, externalId: visitorExternalId(token) } },
    select: { id: true },
  });
  if (!customer) return empty();
  const conv = await prisma.conversation.findUnique({
    where: { channelId_customerId: { channelId: channel.id, customerId: customer.id } },
    select: { id: true, mode: true },
  });
  if (!conv) return empty();

  const visible = {
    conversationId: conv.id,
    text: { not: null },
    OR: [{ direction: "INBOUND" as const }, { direction: "OUTBOUND" as const, status: "SENT" as const }],
  };
  const select = { id: true, direction: true, sender: true, text: true, externalId: true, createdAt: true } as const;
  const rows = after
    ? await prisma.message.findMany({ where: { ...visible, createdAt: { gt: after } }, orderBy: { createdAt: "asc" }, take: 100, select })
    : (await prisma.message.findMany({ where: visible, orderBy: { createdAt: "desc" }, take: PAGE, select })).reverse();

  let cursor = rows.length ? rows[rows.length - 1].createdAt : after;
  const [pending, latest] = await Promise.all([
    prisma.message.findFirst({
      where: { conversationId: conv.id, direction: "OUTBOUND", status: { in: ["QUEUED", "SENDING"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.message.findFirst({
      where: { conversationId: conv.id, status: { not: "FAILED" } },
      orderBy: { createdAt: "desc" },
      select: { direction: true, createdAt: true },
    }),
  ]);
  if (pending && (!cursor || pending.createdAt <= cursor)) cursor = new Date(pending.createdAt.getTime() - 1);
  const typing =
    !!pending ||
    (conv.mode === "AI" && latest?.direction === "INBOUND" && Date.now() - latest.createdAt.getTime() < TYPING_WINDOW_MS);

  return json(
    {
      messages: rows.map((m) => ({
        id: m.id,
        ref: m.direction === "INBOUND" ? m.externalId : undefined,
        sender: m.sender,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
      })),
      cursor: cursor ? cursor.toISOString() : null,
      typing,
      shop: channel.shopName,
    },
    200,
    headers,
  );
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const key = (await params).key;
  const ctx = await widgetContext(req, key);
  if (!ctx.ok) return ctx.res;
  const { channel, headers } = ctx;
  const limited = () => json({ error: "rate_limited" }, 429, { ...headers, "Retry-After": "60" });

  if (!ipRateLimit(req, "msg", LIMITS.messagesPerIpPerMin, 60_000)) return limited();
  const token = bearer(req);
  if (!token || !verifyVisitorToken(channel.id, token)) return json({ error: "invalid_token" }, 401, headers);
  const customerExternalId = visitorExternalId(token);
  if (!rateLimit(`msg:tok:${customerExternalId}`, LIMITS.messagesPerTokenPerMin, 60_000)) return limited();
  if (!rateLimit(`msg:ch:${channel.id}`, LIMITS.messagesPerChannelPerMin, 60_000)) return limited();

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    return json({ error: "bad_request" }, 400, headers);
  }
  const raw = (body as { text?: unknown } | null)?.text;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return json({ error: "empty" }, 400, headers);
  if (text.length > WEB_MAX_INBOUND) return json({ error: "too_long", max: WEB_MAX_INBOUND }, 413, headers);

  // Every inbound message can trigger a paid AI call: hard cap per channel (rolling 24 h, counted in the DB).
  const today = await prisma.message.count({
    where: { direction: "INBOUND", createdAt: { gte: new Date(Date.now() - DAY_MS) }, conversation: { channelId: channel.id } },
  });
  if (today >= LIMITS.inboundPerChannelPerDay) {
    console.warn(`[widget] daily inbound cap reached for channel ${channel.id}`);
    return json({ error: "daily_limit" }, 429, { ...headers, "Retry-After": "3600" });
  }

  ensureChannelWorkers();
  const messageId = randomUUID();
  const msg: InboundMessage = { channelType: "WEB", channelExternalId: key, customerExternalId, messageId, text };
  after(() => handleInbound(msg));
  return json({ ok: true, ref: messageId }, 202, headers);
}
