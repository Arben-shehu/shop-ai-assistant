import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { WIDGET_KEY_RE, webAllowedOrigins } from "@/lib/channels/web";

/**
 * Shared plumbing of the public web-widget API (src/app/api/widget/[key]/...). No session auth: the caller is an
 * anonymous visitor on the shop's own site. The widget key in the path identifies the channel (it is in the URL, not
 * the body, so CORS preflights can be answered per channel).
 *
 * CORS rule: a request that carries an Origin header is served only if that origin is in the channel's allowedOrigins
 * or is the app's own origin (widget-demo.html); otherwise 403. Requests without Origin (same-origin GETs from the demo
 * page, non-browser clients) are served: CORS cannot stop non-browser clients anyway, the abuse limits below do.
 */

export type WidgetChannel = { id: string; organizationId: string; shopName: string; origins: string[]; active: boolean };

const appOrigin = () => {
  try {
    return new URL(process.env.BETTER_AUTH_URL ?? "").origin;
  } catch {
    return null;
  }
};

// shortcut: in-memory, single instance; move to DB/Redis when scaling.
// 15 s cache of key -> channel so 3 s polling doesn't hit the DB + decrypt on every request.
// Deactivating / editing origins takes effect within CHANNEL_TTL_MS.
const CHANNEL_TTL_MS = 15_000;
type Cached = { at: number; channel: WidgetChannel | null };
const g = globalThis as unknown as { widgetChannelCache?: Map<string, Cached>; widgetLimits?: Map<string, number[]> };
const channelCache: Map<string, Cached> = (g.widgetChannelCache ??= new Map());

export async function findWidgetChannel(key: string): Promise<WidgetChannel | null> {
  if (!WIDGET_KEY_RE.test(key)) return null;
  const hit = channelCache.get(key);
  if (hit && Date.now() - hit.at < CHANNEL_TTL_MS) return hit.channel;
  const row = await prisma.channel.findUnique({
    where: { type_externalId: { type: "WEB", externalId: key } },
    select: { id: true, organizationId: true, isActive: true, credentials: true, organization: { select: { name: true } } },
  });
  const channel = row
    ? { id: row.id, organizationId: row.organizationId, shopName: row.organization.name, origins: webAllowedOrigins(row), active: row.isActive }
    : null;
  if (channelCache.size > 5_000) channelCache.clear();
  channelCache.set(key, { at: Date.now(), channel });
  return channel;
}

/** CORS headers for an allowed origin; null when the request's Origin is present and not allowed. */
export function corsHeaders(req: NextRequest, channel: WidgetChannel | null): Record<string, string> | null {
  const origin = req.headers.get("origin");
  const base: Record<string, string> = { Vary: "Origin", "Cache-Control": "no-store" };
  if (!origin) return base;
  if (!channel || !(channel.origins.includes(origin) || origin === appOrigin())) return null;
  return {
    ...base,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
  };
}

export function json(body: unknown, status: number, headers: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

export const forbidden = () =>
  NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers: { Vary: "Origin", "Cache-Control": "no-store" } });

/**
 * Resolves the channel and applies the CORS rule. Unknown key: 404. Deactivated channel: 404 with CORS headers for
 * allowed origins, so the widget on the shop's site can read the status and show "unavailable".
 */
export async function widgetContext(
  req: NextRequest,
  key: string,
): Promise<{ ok: true; channel: WidgetChannel; headers: Record<string, string> } | { ok: false; res: NextResponse }> {
  const channel = await findWidgetChannel(key);
  if (!channel) return { ok: false, res: NextResponse.json({ error: "not_found" }, { status: 404, headers: { Vary: "Origin", "Cache-Control": "no-store" } }) };
  const headers = corsHeaders(req, channel);
  if (!headers) return { ok: false, res: forbidden() };
  if (!channel.active) return { ok: false, res: json({ error: "not_found" }, 404, headers) };
  return { ok: true, channel, headers };
}

export async function preflight(req: NextRequest, key: string) {
  const ctx = await widgetContext(req, key);
  if (!ctx.ok) return ctx.res;
  return new NextResponse(null, { status: 204, headers: ctx.headers });
}

/** Bearer token from the Authorization header. */
export function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  const m = h && /^Bearer ([A-Za-z0-9._-]{1,200})$/.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * Client IP for rate limiting. Takes the LAST x-forwarded-for entry (the one appended by the hop closest to us).
 * Next fills x-forwarded-for with the socket address only when the request has none (base-server `??=`); a
 * client-sent header is passed through untouched. So with no reverse proxy (today) honest browsers are limited by
 * their real IP, but per-IP limits can be dodged with a forged header. The per-channel limits (in-memory burst +
 * daily DB cap) are not spoofable and are the real backstop against paid-AI abuse. Once a proxy in front
 * overwrites/appends the header, the last entry is reliable.
 */
export function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || req.headers.get("x-real-ip")?.trim() || null;
}

/**
 * Per-IP limit. If no address is known at all (should not happen: Next sets x-forwarded-for from the socket) the
 * per-IP limit is skipped rather than putting every visitor in one bucket; per-token / per-channel limits still apply.
 */
export function ipRateLimit(req: NextRequest, scope: string, limit: number, windowMs: number): boolean {
  const ip = clientIp(req);
  return ip === null || rateLimit(`${scope}:ip:${ip}`, limit, windowMs);
}

// shortcut: in-memory, single instance; move to DB/Redis when scaling.
// Sliding-window limiter: `limit` hits per `windowMs` per key. Returns false when the hit is refused (not recorded).
const limits: Map<string, number[]> = (g.widgetLimits ??= new Map());
let lastSweep = 0;

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, hits] of limits) if (!hits.length || now - hits[hits.length - 1] > 3_600_000) limits.delete(k);
  }
  const hits = (limits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    limits.set(key, hits);
    return false;
  }
  hits.push(now);
  limits.set(key, hits);
  return true;
}

export const LIMITS = {
  messagesPerTokenPerMin: 10,
  messagesPerIpPerMin: 20,
  sessionsPerIpPerHour: 20,
  pollsPerIpPerMin: 120, // ~3 s polling from a few tabs behind one IP
  // Per channel (not spoofable): bursts across all visitors of one shop.
  messagesPerChannelPerMin: 60,
  sessionsPerChannelPerHour: 300,
  inboundPerChannelPerDay: 500, // counted in the DB (rolling 24 h)
} as const;

/** Reads a small JSON body (capped before parsing). */
export async function readJson(req: NextRequest, maxBytes = 8_192): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) throw new Error("too_large");
  const raw = await req.text();
  if (raw.length > maxBytes) throw new Error("too_large");
  return raw ? JSON.parse(raw) : {};
}
