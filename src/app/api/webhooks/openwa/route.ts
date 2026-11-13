import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleInbound } from "@/lib/inbound";
import type { InboundMessage } from "@/lib/channels/types";
import { resolveContact } from "@/lib/channels/openwa";
import { setChannelStatus } from "@/lib/channels/status";
import { ensureChannelWorkers } from "@/lib/channels/workers";

/**
 * Inbound webhook of the OpenWA gateway (registered per session by ensureWebhook()).
 * Envelope: { event, timestamp, sessionId, idempotencyKey, deliveryId, data }, header
 * X-OpenWA-Signature: sha256=<hex HMAC-SHA256 of the raw body with OPENWA_WEBHOOK_SECRET>.
 * `message.received` data: { id, from, to, chatId, body, type, timestamp, fromMe, isGroup,
 *   media?: { mimetype, filename?, data (base64) }, quotedMessage? }  (type = whatsapp-web.js native: chat, image, ptt...)
 * The gateway aborts a delivery after 10 s and retries, so we verify + filter inline, answer 200 at once and do the
 * contact lookup (<= 5 s) and handleInbound() in after().
 * Images: the gateway inlines the media as base64; we store it as a data: URL (capped at 5 MB) so Claude can read it.
 */

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

const envelope = z.object({
  event: z.string(),
  sessionId: z.string().min(1).max(128),
  data: z.record(z.string(), z.unknown()).default({}),
});

const messageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  body: z.string().optional().default(""),
  type: z.string().optional(),
  fromMe: z.boolean().optional(),
  isGroup: z.boolean().optional(),
  media: z.object({ mimetype: z.string(), data: z.string().optional() }).partial().optional(),
});

function validSignature(raw: string, header: string | null, secret: string) {
  if (!header) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const ok = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  const secret = process.env.OPENWA_WEBHOOK_SECRET;
  const raw = await req.text();
  if (!secret) {
    console.error("[webhook/openwa] OPENWA_WEBHOOK_SECRET is not set; rejecting");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  if (!validSignature(raw, req.headers.get("x-openwa-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  ensureChannelWorkers();

  let env: z.infer<typeof envelope>;
  try {
    env = envelope.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const channel = await prisma.channel.findUnique({
    where: { type_externalId: { type: "WHATSAPP_OPENWA", externalId: env.sessionId } },
    select: { id: true, organizationId: true, isActive: true, status: true },
  });
  if (!channel) {
    console.warn(`[webhook/openwa] unknown session ${env.sessionId}; ignored`);
    return ok();
  }

  if (env.event === "session.status") {
    // Not emitted by the current gateway build (status is polled by the channel monitor); handled if it ever is.
    const s = String(env.data.status ?? "");
    const next = s === "ready" ? "CONNECTED" : s === "disconnected" || s === "failed" ? "DISCONNECTED" : null;
    if (next && !(next === "DISCONNECTED" && channel.status === "PENDING")) await setChannelStatus(channel, next);
    return ok();
  }
  if (env.event !== "message.received" || !channel.isActive) return ok();

  const parsed = messageSchema.safeParse(env.data);
  if (!parsed.success) return ok();
  const m = parsed.data;
  // Own/outgoing, groups, status stories, broadcasts and channels are not customer conversations.
  if (m.fromMe || m.isGroup || /@(g\.us|broadcast|newsletter)$/.test(m.from)) return ok();

  let mediaUrl: string | undefined;
  let mediaType: string | undefined;
  if (m.media?.mimetype?.startsWith("image/") && m.media.data && (m.media.data.length * 3) / 4 <= MAX_MEDIA_BYTES) {
    mediaType = m.media.mimetype;
    mediaUrl = `data:${mediaType};base64,${m.media.data}`;
  }
  const text = m.body?.trim() || undefined;
  if (!text && !mediaUrl) return ok(); // voice notes, stickers, locations... not handled yet

  const sessionId = env.sessionId;
  after(async () => {
    try {
      // "<digits>@lid" senders are masked: ask the gateway for the real number and name.
      const contact = await resolveContact(sessionId, m.from);
      const fromDigits = m.from.endsWith("@c.us") ? m.from.slice(0, -5).replace(/\D/g, "") : undefined;
      const msg: InboundMessage = {
        channelType: "WHATSAPP_OPENWA",
        channelExternalId: sessionId,
        customerExternalId: contact.phone || fromDigits || m.from, // fallback: the lid jid, still repliable
        customerName: contact.name,
        messageId: m.id,
        text,
        mediaUrl,
        mediaType,
      };
      await handleInbound(msg);
    } catch (e) {
      console.error(`[webhook/openwa] handleInbound failed for ${m.id}: ${e instanceof Error ? e.message : e}`);
    }
  });
  return ok();
}
