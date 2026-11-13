import type { NextRequest } from "next/server";
import { issueVisitorToken } from "@/lib/channels/web";
import { ipRateLimit, json, LIMITS, preflight, rateLimit, widgetContext } from "@/lib/widget-api";

/**
 * POST /api/widget/{key}/session -> { token, shop }
 * Issues a visitor token (stateless, HMAC-signed, bound to the channel). Nothing is stored until the visitor writes;
 * the customer row is then keyed by the token's hash. The client never chooses a conversation id.
 */

type Ctx = { params: Promise<{ key: string }> };

export async function OPTIONS(req: NextRequest, { params }: Ctx) {
  return preflight(req, (await params).key);
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
  return json({ token: issueVisitorToken(ctx.channel.id), shop: ctx.channel.shopName }, 200, ctx.headers);
}
