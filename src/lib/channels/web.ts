import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Channel } from "@/generated/prisma/client";
import type { ChannelAdapter } from "@/lib/channels/types";
import { loadChannelCredentials } from "@/lib/channels/credentials";

/**
 * Web chat widget channel (public/widget.js). Channel.externalId = public widget key (embedded in the shop's page),
 * Channel.credentials = encrypted { kind: "web", allowedOrigins }.
 * There is no provider: the widget polls GET /api/widget/{key}/messages, so "delivering" an outbound message only
 * means marking it SENT (the outbox worker does that when sendText returns).
 * Visitors get a stateless signed token (no DB row until they write); the customer row is keyed by its hash.
 */

export const WEB_MAX_TEXT = 4000;
/** Longest message a visitor may send. */
export const WEB_MAX_INBOUND = 1000;
export const MAX_ORIGINS = 20;

export const webAdapter: ChannelAdapter = {
  async sendText() {
    return {};
  },
};

/** Public widget key: 24 random bytes, base64url (32 chars). */
export const generateWidgetKey = () => `wk_${randomBytes(24).toString("base64url")}`;
export const WIDGET_KEY_RE = /^wk_[A-Za-z0-9_-]{32}$/;

/** "https://Shop.al/path" -> "https://shop.al". Null for anything that is not a plain http(s) origin. */
export function normalizeOrigin(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.includes("*")) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function webAllowedOrigins(channel: Pick<Channel, "credentials">): string[] {
  const c = loadChannelCredentials(channel);
  return c?.kind === "web" ? c.allowedOrigins : [];
}

// ---------------------------------------------------------------- visitor tokens

const tokenKey = () => createHmac("sha256", Buffer.from(process.env.ENCRYPTION_KEY!, "hex")).update("widget-visitor-token-v1").digest();
const sign = (channelId: string, rand: string) =>
  createHmac("sha256", tokenKey()).update(`${channelId}:${rand}`).digest("base64url");

/** New visitor token `<32 random bytes>.<hmac>`, bound to the channel. Never stored; only its hash is. */
export function issueVisitorToken(channelId: string): string {
  const rand = randomBytes(32).toString("base64url");
  return `${rand}.${sign(channelId, rand)}`;
}

/** True only for tokens this server issued for this channel. */
export function verifyVisitorToken(channelId: string, token: string): boolean {
  const m = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const expected = Buffer.from(sign(channelId, m[1]));
  const got = Buffer.from(m[2]);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Customer.externalId of a visitor: the raw token never reaches the DB. */
export const visitorExternalId = (token: string) => `web:${createHash("sha256").update(token).digest("hex")}`;
