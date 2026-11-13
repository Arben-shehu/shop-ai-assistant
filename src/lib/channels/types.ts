import type { Channel, ChannelType } from "@/generated/prisma/client";

/** A message received from any provider, normalised. Produced by webhook routes, consumed by handleInbound(). */
export type InboundMessage = {
  channelType: ChannelType;
  /** Provider id of OUR account: OpenWA session id / WA phone_number_id / IG account id / web widget key. Matches Channel.externalId. */
  channelExternalId: string;
  /** Provider id of the customer: phone digits (WhatsApp), IGSID (Instagram) or "web:<sha256(visitor token)>" (WEB). */
  customerExternalId: string;
  customerName?: string;
  /** Provider message id, used to drop duplicate webhook deliveries. */
  messageId: string;
  text?: string;
  /** Publicly fetchable or data: URL of an attached image. */
  mediaUrl?: string;
  mediaType?: string;
};

/** Decrypted credentials stored in Channel.credentials (shape depends on type). */
export type ChannelCredentials =
  | { kind: "openwa" } // OpenWA URL + API key are global env (one gateway, many sessions)
  | { kind: "meta_whatsapp"; accessToken: string }
  | { kind: "instagram"; accessToken: string }
  | { kind: "web"; allowedOrigins: string[] }; // normalised origins ("https://shop.al") allowed to embed the widget

export interface ChannelAdapter {
  /** Send a text reply. Returns the provider message id when available. Throws on failure. */
  sendText(channel: Channel, to: string, text: string): Promise<{ externalId?: string }>;
}
