/**
 * Simulate an inbound WhatsApp message from the OpenWA gateway (for end-to-end tests without a phone).
 *
 * Usage:
 *   npx tsx scripts/channels-simulate.ts <sessionId> <fromPhone> "<text>" [--lid] [--url http://localhost:4710]
 *
 *   sessionId  Channel.externalId of a WHATSAPP_OPENWA channel (the OpenWA session UUID)
 *   fromPhone  customer phone, e.g. 355691234567 or 0691234567 (-> "355691234567@c.us"; with --lid "<digits>@lid")
 *   text       message body
 *
 * Signs the body exactly like the gateway (X-OpenWA-Signature: sha256=HMAC(raw body, OPENWA_WEBHOOK_SECRET))
 * and POSTs it to <url>/api/webhooks/openwa. Reads OPENWA_WEBHOOK_SECRET and BETTER_AUTH_URL from .env.
 * Expect HTTP 200 {"ok":true}; the message is processed after the response (see the dev server log).
 * Each run uses a new message id, so it is never dropped as a duplicate.
 */
import { createHmac, randomBytes } from "node:crypto";

try {
  process.loadEnvFile(".env");
} catch {}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
};
const lid = args.includes("--lid");
if (lid) args.splice(args.indexOf("--lid"), 1);
const url = (flag("--url") ?? process.env.BETTER_AUTH_URL ?? "http://localhost:4710").replace(/\/+$/, "");
const [sessionId, fromPhone, text] = args;

if (!sessionId || !fromPhone || !text) {
  console.error('Usage: npx tsx scripts/channels-simulate.ts <sessionId> <fromPhone> "<text>" [--lid] [--url <appUrl>]');
  process.exit(1);
}
const secret = process.env.OPENWA_WEBHOOK_SECRET;
if (!secret) {
  console.error("OPENWA_WEBHOOK_SECRET is not set (.env)");
  process.exit(1);
}

// Real jids carry international digits: normalise local input like the app does (0xxx -> 355xxx, 00 -> drop).
let digits = fromPhone.replace(/\D/g, "");
if (!lid) digits = digits.startsWith("00") ? digits.slice(2) : digits.startsWith("0") ? "355" + digits.slice(1) : digits;
const from = `${digits}@${lid ? "lid" : "c.us"}`;
const messageId = `false_${from}_SIM${randomBytes(8).toString("hex").toUpperCase()}`;
const payload = {
  event: "message.received",
  timestamp: new Date().toISOString(),
  sessionId,
  idempotencyKey: `msg_${sessionId}_${messageId}`,
  deliveryId: `dlv_${randomBytes(8).toString("hex")}`,
  data: {
    id: messageId,
    from,
    to: "355000000000@c.us",
    chatId: from,
    body: text,
    type: "chat",
    timestamp: Math.floor(Date.now() / 1000),
    fromMe: false,
    isGroup: false,
  },
};
const body = JSON.stringify(payload);
const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

async function main() {
  const res = await fetch(`${url}/api/webhooks/openwa`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "OpenWA-Webhook/1.0.0 (simulated)",
      "X-OpenWA-Event": "message.received",
      "X-OpenWA-Signature": signature,
    },
    body,
  });
  console.log(`${res.status} ${await res.text()}  (message ${messageId} from ${from})`);
  process.exit(res.ok ? 0 : 1);
}

void main();
