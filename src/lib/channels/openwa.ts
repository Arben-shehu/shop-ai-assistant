import "server-only";
import type { Channel } from "@/generated/prisma/client";
import type { ChannelAdapter } from "@/lib/channels/types";
import { InvalidRecipientError, toWhatsAppChatId } from "@/lib/channels/phone";

/**
 * Client for the self-hosted OpenWA gateway (fork DriniNazeraj/whatsApp-comment @ 980d300 = OpenWA 0.1.6,
 * see docker-compose.yml). One gateway, many sessions: Channel.externalId = the session UUID.
 *
 * Endpoints used (all under OPENWA_URL, header X-API-Key):
 *   POST   /api/sessions {name, config}          -> { id, status }
 *   GET    /api/sessions/:id                      -> { id, status, phone, pushName }  (404 = gone)
 *   POST   /api/sessions/:id/start                (400 "already started" when an engine object exists)
 *   POST   /api/sessions/:id/stop                 (destroys the browser, keeps the pairing)
 *   GET    /api/sessions/:id/qr                   -> { qrCode: "data:image/png;base64,...", status } (400 not ready)
 *   DELETE /api/sessions/:id
 *   GET    /api/sessions/:id/webhooks             -> [{ id, url, events, active }]
 *   POST   /api/sessions/:id/webhooks {url, events, secret, retryCount}
 *   GET    /api/sessions/:id/contacts/:jid        -> { id, name, pushName, number }
 *   POST   /api/sessions/:id/messages/send-text {chatId, text} -> { messageId, timestamp }
 *
 * Status values: created | initializing | qr_ready | authenticating | ready | disconnected | failed.
 * NOTE: never use /api/sessions/:id/status — on this gateway it is the WhatsApp *stories* endpoint
 * (SunEasy WhatsAppSender.cs), and /api/health is always 200 even with a dead session.
 */

export type OpenwaStatus =
  | "created"
  | "initializing"
  | "qr_ready"
  | "authenticating"
  | "ready"
  | "disconnected"
  | "failed";

export type OpenwaSession = { id: string; name: string; status: OpenwaStatus; phone?: string | null; pushName?: string | null };

export class OpenwaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Max text per WhatsApp message on this gateway; longer texts are rejected with 400. */
export const OPENWA_MAX_TEXT = 4096;

const baseUrl = () => (process.env.OPENWA_URL || "http://localhost:2785").replace(/\/+$/, "");

/** Where the gateway (inside Docker) POSTs inbound messages. */
export function openwaWebhookUrl(): string {
  if (process.env.OPENWA_WEBHOOK_URL) return process.env.OPENWA_WEBHOOK_URL;
  let port = "4710";
  try {
    port = new URL(process.env.BETTER_AUTH_URL ?? "").port || port;
  } catch {}
  return `http://host.docker.internal:${port}/api/webhooks/openwa`;
}

export const openwaConfigured = () => !!process.env.OPENWA_API_KEY;

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api${path}`, {
      ...rest,
      headers: {
        "X-API-Key": process.env.OPENWA_API_KEY ?? "",
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...rest.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    throw new OpenwaError(`OpenWA i paarritshëm: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { message?: string | string[] };
      if (j.message) msg = Array.isArray(j.message) ? j.message.join("; ") : j.message;
    } catch {}
    throw new OpenwaError(`OpenWA ${res.status}: ${msg}`, res.status);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export function createSession(name: string) {
  return call<OpenwaSession>("/sessions", { method: "POST", body: JSON.stringify({ name, config: { autoReconnect: true } }) });
}

/** null when the gateway no longer knows the session (deleted / volume wiped). */
export async function getSession(id: string): Promise<OpenwaSession | null> {
  try {
    return await call<OpenwaSession>(`/sessions/${encodeURIComponent(id)}`, { timeoutMs: 8_000 });
  } catch (e) {
    if (e instanceof OpenwaError && e.status === 404) return null;
    throw e;
  }
}

/** Starts the engine. Returns false when it was already started (gateway answers 400). */
export async function startSession(id: string): Promise<boolean> {
  try {
    await call(`/sessions/${encodeURIComponent(id)}/start`, { method: "POST", timeoutMs: 60_000 });
    return true;
  } catch (e) {
    if (e instanceof OpenwaError && e.status === 400) return false;
    throw e;
  }
}

export async function stopSession(id: string) {
  await call(`/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", timeoutMs: 30_000 });
}

export async function deleteSession(id: string) {
  try {
    await call(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs: 30_000 });
  } catch (e) {
    if (!(e instanceof OpenwaError && e.status === 404)) throw e;
  }
}

/** Current QR (PNG data URL, expires ~30 s — refetch), or null when not available yet / already paired. */
export async function getQr(id: string): Promise<string | null> {
  try {
    const r = await call<{ qrCode?: string }>(`/sessions/${encodeURIComponent(id)}/qr`, { timeoutMs: 8_000 });
    return r?.qrCode ?? null;
  } catch (e) {
    if (e instanceof OpenwaError && e.status === 400) return null;
    throw e;
  }
}

/**
 * Port of SunEasy WhatsAppWebhookRegistrar.cs: make sure the session has our inbound webhook.
 * Webhooks live in the gateway's SQLite bound to the session id, so a new session (rescan) has none.
 * Matching is by URL only, so it is idempotent and never piles up duplicates. Never throws.
 */
export async function ensureWebhook(sessionId: string): Promise<boolean> {
  const url = openwaWebhookUrl();
  try {
    const raw = await call<unknown>(`/sessions/${encodeURIComponent(sessionId)}/webhooks`, { timeoutMs: 8_000 });
    const list = Array.isArray(raw) ? raw : ((raw as { data?: unknown })?.data ?? []);
    const has =
      Array.isArray(list) &&
      list.some((w: { url?: string; active?: boolean }) => w?.url?.toLowerCase() === url.toLowerCase() && w.active !== false);
    if (has) return true;
    console.warn(`[openwa] inbound webhook missing on session ${sessionId}; registering`);
    await call(`/sessions/${encodeURIComponent(sessionId)}/webhooks`, {
      method: "POST",
      timeoutMs: 8_000,
      body: JSON.stringify({
        url,
        events: ["message.received"],
        secret: process.env.OPENWA_WEBHOOK_SECRET || undefined,
        retryCount: 3,
      }),
    });
    return true;
  } catch (e) {
    console.error(`[openwa] webhook registration failed for session ${sessionId}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/**
 * Port of SunEasy WhatsAppContactResolver.cs. Senders often arrive as "<digits>@lid" (masked, no name).
 * The gateway resolves them: `id` is the real "<phone>@c.us" when WhatsApp disclosed it; name = name ?? pushName.
 * TRAP: `number` holds the LID digits for lid contacts — never use it. 5 s timeout (gateway webhook aborts at 10 s).
 * Best-effort: returns {} on any failure.
 */
export async function resolveContact(sessionId: string, jid: string): Promise<{ phone?: string; name?: string }> {
  try {
    const raw = await call<Record<string, unknown>>(
      `/sessions/${encodeURIComponent(sessionId)}/contacts/${encodeURIComponent(jid)}`,
      { timeoutMs: 5_000 },
    );
    const c = (raw && typeof raw.data === "object" ? raw.data : raw) as { id?: unknown; name?: unknown; pushName?: unknown };
    const id = typeof c?.id === "string" ? c.id : "";
    const phone = id.endsWith("@c.us") ? id.slice(0, -5).replace(/\D/g, "") : undefined;
    const name = [c?.name, c?.pushName].find((v): v is string => typeof v === "string" && v.trim() !== "")?.trim();
    return { phone: phone || undefined, name };
  } catch {
    return {};
  }
}

export const openwaAdapter: ChannelAdapter = {
  async sendText(channel: Channel, to: string, text: string) {
    if (!openwaConfigured()) throw new Error("OpenWA nuk është konfiguruar në server (OPENWA_API_KEY)");
    const chatId = toWhatsAppChatId(to);
    if (!chatId) throw new InvalidRecipientError(`Numër WhatsApp i pavlefshëm: ${to}`);
    const r = await call<{ messageId?: string | null }>(`/sessions/${encodeURIComponent(channel.externalId)}/messages/send-text`, {
      method: "POST",
      timeoutMs: 45_000,
      body: JSON.stringify({ chatId, text }),
    });
    return { externalId: r?.messageId ?? undefined };
  },
};
