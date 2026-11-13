import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleInbound } from "@/lib/inbound";
import type { InboundMessage } from "@/lib/channels/types";
import { downloadMetaMedia } from "@/lib/channels/meta-whatsapp";
import { ensureChannelWorkers } from "@/lib/channels/workers";

/**
 * Meta webhook for the official WhatsApp Cloud API (object "whatsapp_business_account") and the Instagram API
 * (object "instagram"). GET = subscription check (hub.verify_token === META_VERIFY_TOKEN).
 * POST is verified with X-Hub-Signature-256 (HMAC-SHA256 of the raw body, key META_APP_SECRET); without a secret
 * it is rejected in production and accepted with a warning in development.
 * Status updates, echoes and our own sends are ignored. Answers 200 at once, processing runs in after().
 */

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (p.get("hub.mode") === "subscribe" && token && p.get("hub.verify_token") === token) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function validSignature(raw: string, header: string | null, secret: string) {
  if (!header) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Normalised message plus an optional WhatsApp media id that still has to be downloaded. */
type Pending = { msg: InboundMessage; waMediaId?: string };

function parseWhatsApp(body: Obj): Pending[] {
  const out: Pending[] = [];
  for (const entry of arr(body.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      if (c.field !== "messages") continue;
      const value = obj(c.value);
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      const names = new Map(arr(value.contacts).map((x) => [str(obj(x).wa_id), str(obj(obj(x).profile).name)]));
      for (const raw of arr(value.messages)) {
        // value.statuses (sent/delivered/read) are ignored: only value.messages are customer messages.
        const m = obj(raw);
        const from = str(m.from);
        const id = str(m.id);
        if (!from || !id) continue;
        const image = obj(m.image);
        const text = m.type === "text" ? str(obj(m.text).body) : m.type === "image" ? str(image.caption) : undefined;
        const waMediaId = m.type === "image" ? str(image.id) : undefined;
        if (!text && !waMediaId) continue;
        out.push({
          msg: {
            channelType: "WHATSAPP_META",
            channelExternalId: phoneNumberId,
            customerExternalId: from.replace(/\D/g, ""),
            customerName: names.get(from),
            messageId: id,
            text,
          },
          waMediaId,
        });
      }
    }
  }
  return out;
}

function parseInstagram(body: Obj): Pending[] {
  const out: Pending[] = [];
  for (const e of arr(body.entry)) {
    const entry = obj(e);
    const accountId = str(entry.id);
    // Real messages arrive as entry.messaging[]; the dashboard "test" sends entry.changes[].value.
    const events = [
      ...arr(entry.messaging),
      ...arr(entry.changes).filter((c) => obj(c).field === "messages").map((c) => obj(c).value),
    ];
    for (const ev of events) {
      const x = obj(ev);
      const message = obj(x.message);
      const sender = str(obj(x.sender).id);
      const recipient = str(obj(x.recipient).id) ?? accountId;
      const mid = str(message.mid);
      if (!sender || !recipient || !mid) continue;
      if (message.is_echo || message.is_deleted || sender === accountId || sender === recipient) continue;
      const image = arr(message.attachments).map(obj).find((a) => a.type === "image");
      const mediaUrl = str(obj(image?.payload).url);
      const text = str(message.text);
      if (!text && !mediaUrl) continue;
      out.push({
        msg: {
          channelType: "INSTAGRAM",
          channelExternalId: recipient,
          customerExternalId: sender,
          messageId: mid,
          text,
          mediaUrl,
          mediaType: mediaUrl ? "image/jpeg" : undefined,
        },
      });
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.META_APP_SECRET;
  if (secret) {
    if (!validSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[webhook/meta] META_APP_SECRET is not set; rejecting");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  } else {
    console.warn("[webhook/meta] META_APP_SECRET is not set; accepting UNSIGNED payload (development only)");
  }
  ensureChannelWorkers();

  let body: Obj;
  try {
    body = obj(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  const pending =
    body.object === "whatsapp_business_account" ? parseWhatsApp(body) : body.object === "instagram" ? parseInstagram(body) : [];
  if (pending.length === 0) return NextResponse.json({ ok: true });

  after(async () => {
    for (const { msg, waMediaId } of pending) {
      try {
        if (waMediaId) {
          const channel = await prisma.channel.findUnique({
            where: { type_externalId: { type: "WHATSAPP_META", externalId: msg.channelExternalId } },
          });
          const media = channel ? await downloadMetaMedia(channel, waMediaId) : undefined;
          if (media) {
            msg.mediaUrl = media.url;
            msg.mediaType = media.type;
          } else if (!msg.text) continue;
        }
        await handleInbound(msg);
      } catch (e) {
        console.error(`[webhook/meta] handleInbound failed for ${msg.messageId}: ${e instanceof Error ? e.message : e}`);
      }
    }
  });
  return NextResponse.json({ ok: true });
}
