import "server-only";
import type { ChannelAdapter } from "@/lib/channels/types";
import { loadChannelCredentials } from "@/lib/channels/credentials";

/**
 * Instagram API with Instagram Login (graph.instagram.com), as in the old project's src/lib/instagram.ts.
 * Channel.externalId = IG professional account id, recipient = IGSID, token in Channel.credentials.
 */

export const INSTAGRAM_MAX_TEXT = 1000;
const graph = () => `https://graph.instagram.com/${process.env.META_API_VERSION || "v24.0"}`;

async function graphError(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new Error(`Instagram ${res.status}: ${body?.error?.message ?? res.statusText}`);
}

export const instagramAdapter: ChannelAdapter = {
  async sendText(channel, to, text) {
    const c = loadChannelCredentials(channel);
    if (c?.kind !== "instagram") throw new Error("Kredencialet e Instagram mungojnë");
    const res = await fetch(`${graph()}/${encodeURIComponent(channel.externalId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: to }, message: { text } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw await graphError(res);
    const data = (await res.json()) as { message_id?: string };
    return { externalId: data.message_id };
  },
};

/** Cheap GET used by "Testo lidhjen": returns the account username. */
export async function testInstagram(accessToken: string): Promise<string> {
  const res = await fetch(`${graph()}/me?fields=user_id,username`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw await graphError(res);
  const d = (await res.json()) as { username?: string; user_id?: string };
  return d.username ? `@${d.username}` : (d.user_id ?? "OK");
}
