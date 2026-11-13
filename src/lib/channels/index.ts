import "server-only";
import type { ChannelType } from "@/generated/prisma/client";
import type { ChannelAdapter } from "@/lib/channels/types";
import { openwaAdapter, OPENWA_MAX_TEXT } from "@/lib/channels/openwa";
import { metaWhatsAppAdapter, META_WA_MAX_TEXT } from "@/lib/channels/meta-whatsapp";
import { instagramAdapter, INSTAGRAM_MAX_TEXT } from "@/lib/channels/instagram";
import { webAdapter, WEB_MAX_TEXT } from "@/lib/channels/web";

export { loadChannelCredentials } from "@/lib/channels/credentials";

const adapters: Record<ChannelType, ChannelAdapter> = {
  WHATSAPP_OPENWA: openwaAdapter,
  WHATSAPP_META: metaWhatsAppAdapter,
  INSTAGRAM: instagramAdapter,
  WEB: webAdapter, // no provider: the widget polls the DB, so delivery = SENT
};

export function getAdapter(type: ChannelType): ChannelAdapter {
  return adapters[type];
}

/** Longest text one provider message may carry; longer replies are split into numbered parts. */
export const maxTextLength: Record<ChannelType, number> = {
  WHATSAPP_OPENWA: OPENWA_MAX_TEXT,
  WHATSAPP_META: META_WA_MAX_TEXT,
  INSTAGRAM: INSTAGRAM_MAX_TEXT,
  WEB: WEB_MAX_TEXT,
};

export const channelTypeLabel: Record<ChannelType, string> = {
  WHATSAPP_OPENWA: "WhatsApp (OpenWA)",
  WHATSAPP_META: "WhatsApp zyrtar (Meta)",
  INSTAGRAM: "Instagram",
  WEB: "Web chat",
};
