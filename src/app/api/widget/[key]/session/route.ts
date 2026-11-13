import type { NextRequest } from "next/server";
import { issueVisitorToken } from "@/lib/channels/web";
import { ipRateLimit, json, LIMITS, preflight, rateLimit, widgetContext } from "@/lib/widget-api";

/**
 * POST /api/widget/{key}/session -> { token, shop, whatsapp }
 * Issues a visitor token (stateless, HMAC-signed, bound to the channel). Nothing is stored until the visitor writes;
 * the customer row is then keyed by the token's hash. The client never chooses a conversation id.
 *
 * GET /api/widget/{key}/session -> { shop, whatsapp }
 * Token-less widget config, fetched when the panel is first opened (new visitors get no token before they write,
 * returning visitors never call POST again), so the "Vazhdo në WhatsApp" link shows right away.
 *
 * `whatsapp` = digits of our WhatsApp number or null, resolved server-side (findWidgetChannel), never from the client.
 */

type Ctx = { params: Promise<{ key: string }> };

export async function OPTIONS(req: NextRequest, { params }: Ctx) {
  return preflight(req, (await params).key);
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await widgetContext(req, (await params).key);
  if (!ctx.ok) return ctx.res;
  if (!ipRateLimit(req, "poll", LIMITS.pollsPerIpPerMin, 60_000)) {
    return json({ error: "rate_limited" }, 429, { ...ctx.headers, "Retry-After": "30" });
  }
  return json({ shop: ctx.channel.shopName, whatsapp: ctx.channel.whatsapp }, 200, ctx.headers);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const ctx = await widgetContext(req, (await params).key);
  if (!ctx.ok) return ctx.res;
  if (
    !ipRateLimit(req, "session", LIMITS.sessionsPerIpPerHour, 3_600_000) ||
    !rateLimit(`session:ch:${ctx.channel.id}`, LIMITS.sessionsPerChannelPerHour, 3_600_000)
  ) {
    return json({ error: "rate_limited" }, 429, { ...ctx.headers, "Retry-After": "600" });
  }
  return json(
    { token: issueVisitorToken(ctx.channel.id), shop: ctx.channel.shopName, whatsapp: ctx.channel.whatsapp },
    200,
    ctx.headers,
  );
}
