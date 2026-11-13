import "server-only";
import type { Channel, ChannelStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/events";
import { notify } from "@/lib/notify";

/** Set a channel's status (only writes + publishes when it actually changes). Returns true on change. */
export async function setChannelStatus(channel: Pick<Channel, "id" | "organizationId">, status: ChannelStatus) {
  const r = await prisma.channel.updateMany({ where: { id: channel.id, status: { not: status } }, data: { status } });
  if (r.count) publish(channel.organizationId, { type: "channel", channelId: channel.id });
  return r.count > 0;
}

export const markChannelConnected = (channel: Pick<Channel, "id" | "organizationId">) => setChannelStatus(channel, "CONNECTED");

/** Channel -> ERROR. The CHANNEL_ERROR notification goes out only on the transition, so it fires once per outage. */
export async function markChannelError(channel: Pick<Channel, "id" | "organizationId" | "name">, reason: string) {
  if (!(await setChannelStatus(channel, "ERROR"))) return;
  console.error(`[channels] channel ${channel.id} -> ERROR: ${reason}`);
  await notify(channel.organizationId, {
    type: "CHANNEL_ERROR",
    title: `Kanali "${channel.name}" ka problem`,
    body: reason.slice(0, 500),
    link: "/channels",
  }).catch((e) => console.error("[channels] notify failed:", e));
}

/**
 * Store our own WhatsApp number (digits only) as reported by the provider, e.g. OpenWA GET /api/sessions/:id `phone`
 * once the session is ready. Writes + publishes only when it changed (another number scanned on reconnect).
 * Used by the web widget's "Vazhdo në WhatsApp" link and shown on the Channels page.
 */
export async function saveChannelPhone(channel: Pick<Channel, "id" | "organizationId">, raw: string | null | undefined) {
  const phone = (raw ?? "").replace(/\D/g, "");
  if (phone.length < 8 || phone.length > 15) return false;
  const r = await prisma.channel.updateMany({ where: { id: channel.id, OR: [{ phone: null }, { phone: { not: phone } }] }, data: { phone } });
  if (r.count) publish(channel.organizationId, { type: "channel", channelId: channel.id });
  return r.count > 0;
}
