import "server-only";
import type { Channel } from "@/generated/prisma/client";
import type { ChannelAdapter } from "@/lib/channels/types";
import { loadChannelCredentials } from "@/lib/channels/credentials";
import { normalizePhone } from "@/lib/channels/phone";

/** Official WhatsApp Cloud API (Graph). Channel.externalId = phone_number_id, token in Channel.credentials. */

export const META_WA_MAX_TEXT = 4096;
const graph = () => `https://graph.facebook.com/${process.env.META_API_VERSION || "v24.0"}`;

async function graphError(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new Error(`Meta ${res.status}: ${body?.error?.message ?? res.statusText}`);
}

function token(channel: Channel) {
  const c = loadChannelCredentials(channel);
  if (c?.kind !== "meta_whatsapp") throw new Error("Kredencialet e WhatsApp (Meta) mungojnë");
  return c.accessToken;
}

export const metaWhatsAppAdapter: ChannelAdapter = {
  async sendText(channel, to, text) {
    const res = await fetch(`${graph()}/${encodeURIComponent(channel.externalId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token(channel)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizePhone(to),
        type: "text",
        text: { preview_url: false, body: text },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw await graphError(res);
    const data = (await res.json()) as { messages?: { id?: string }[] };
    return { externalId: data.messages?.[0]?.id };
  },
};

/** Cheap GET used by "Testo lidhjen": returns the display phone number. */
export async function testMetaWhatsApp(phoneNumberId: string, accessToken: string): Promise<string> {
  const res = await fetch(
    `${graph()}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000), cache: "no-store" },
  );
  if (!res.ok) throw await graphError(res);
  const d = (await res.json()) as { display_phone_number?: string; verified_name?: string };
  return [d.verified_name, d.display_phone_number].filter(Boolean).join(" · ") || phoneNumberId;
}

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

/** Downloads an inbound media object (image) into a data: URL. Returns undefined on failure or when too big. */
export async function downloadMetaMedia(channel: Channel, mediaId: string): Promise<{ url: string; type: string } | undefined> {
  try {
    const t = token(channel);
    const meta = await fetch(`${graph()}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!meta.ok) throw await graphError(meta);
    const m = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!m.url || (m.file_size ?? 0) > MAX_MEDIA_BYTES) return undefined;
    const bin = await fetch(m.url, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(20_000) });
    if (!bin.ok) throw await graphError(bin);
    const buf = Buffer.from(await bin.arrayBuffer());
    if (buf.length > MAX_MEDIA_BYTES) return undefined;
    const type = m.mime_type ?? bin.headers.get("content-type") ?? "image/jpeg";
    return { url: `data:${type};base64,${buf.toString("base64")}`, type };
  } catch (e) {
    console.error(`[meta] media download failed: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}
