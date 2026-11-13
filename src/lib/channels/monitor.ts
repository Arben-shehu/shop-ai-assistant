import "server-only";
import type { Channel } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureWebhook, getSession, openwaConfigured, startSession, stopSession } from "@/lib/channels/openwa";
import { markChannelError, saveChannelPhone, setChannelStatus } from "@/lib/channels/status";

/**
 * Background care for OpenWA channels, ported from SunEasy:
 *  - health monitor (WhatsAppHealthMonitor.cs + WhatsAppSender.GetSessionStatusAsync/RestartSessionAsync):
 *    every 5 min probe GET /api/sessions/{id} (never /status = stories, never /api/health = always 200).
 *    Not ready -> self-heal with POST /start (replays the stored pairing, no QR). The gateway's own reconnect
 *    gives up after 5 attempts and keeps a dead engine object, so when /start answers "already started"
 *    we /stop (destroy, pairing kept) and /start again. 3 consecutive bad probes -> Channel ERROR + one
 *    CHANNEL_ERROR notification. The gateway does not send session.status webhooks, so this is also what
 *    keeps Channel.status in sync.
 *  - webhook reconciler (WhatsAppWebhookReconciler.cs + WhatsAppWebhookRegistrar.cs): on boot (+30 s) and every
 *    15 min make sure every active session still has our inbound webhook (they vanish with a re-minted session).
 * PENDING channels (QR not scanned yet) are never started/stopped here; they only flip to CONNECTED when ready.
 */

const PROBE_MS = 5 * 60_000;
const RECONCILE_MS = 15 * 60_000;
const STARTUP_DELAY_MS = 30_000;
const FAILURES_BEFORE_ALARM = 3;

type MonitorState = { started: boolean; failures: Map<string, number> };
const g = globalThis as unknown as { shopChannelMonitor?: MonitorState };
const state = (g.shopChannelMonitor ??= { started: false, failures: new Map() });

export function startChannelMonitor() {
  if (state.started) return;
  state.started = true;
  const run = (fn: () => Promise<void>, every: number) => {
    const safe = () => fn().catch((e) => console.error("[channel-monitor]", e instanceof Error ? e.message : e));
    setTimeout(() => {
      void safe();
      setInterval(() => void safe(), every).unref?.();
    }, STARTUP_DELAY_MS).unref?.();
  };
  run(probeAll, PROBE_MS);
  run(reconcileWebhooks, RECONCILE_MS);
  console.log("[channel-monitor] started (health 5 min, webhooks 15 min)");
}

const openwaChannels = () =>
  prisma.channel.findMany({ where: { type: "WHATSAPP_OPENWA", isActive: true } });

export async function probeAll() {
  if (!openwaConfigured()) return;
  for (const ch of await openwaChannels()) await probeChannel(ch);
}

async function probeChannel(ch: Channel) {
  let status: string;
  let phone: string | null | undefined;
  try {
    const s = await getSession(ch.externalId);
    if (!s) {
      if (ch.status !== "PENDING") await markChannelError(ch, "Sesioni nuk ekziston më në OpenWA. Lidheni përsëri numrin.");
      return;
    }
    status = s.status;
    phone = s.phone;
  } catch {
    status = "unreachable";
  }

  if (status === "ready") {
    state.failures.delete(ch.id);
    // Every ready probe, not only on the flip: channels connected before Channel.phone existed get it too.
    await saveChannelPhone(ch, phone);
    if (ch.status !== "CONNECTED") {
      await setChannelStatus(ch, "CONNECTED");
      await ensureWebhook(ch.externalId);
    }
    return;
  }
  if (ch.status === "PENDING") return; // waiting for the QR scan

  if (status === "qr_ready" && ch.status === "CONNECTED") {
    // Was paired, now asks for a QR: the phone unlinked the device. Only a human can fix this.
    await markChannelError(ch, "WhatsApp u shkëput nga telefoni. Skanoni përsëri kodin QR.");
    return;
  }

  const failures = (state.failures.get(ch.id) ?? 0) + 1;
  state.failures.set(ch.id, failures);
  if (ch.status === "CONNECTED") await setChannelStatus(ch, "DISCONNECTED");

  if (status === "disconnected" || status === "failed" || status === "created") {
    try {
      const started = await startSession(ch.externalId);
      if (!started && failures >= 2) {
        await stopSession(ch.externalId);
        await startSession(ch.externalId);
      }
      console.log(`[channel-monitor] session ${ch.externalId} was ${status}; restart requested`);
    } catch (e) {
      console.warn(`[channel-monitor] restart of ${ch.externalId} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (failures >= FAILURES_BEFORE_ALARM) {
    await markChannelError(
      ch,
      status === "unreachable"
        ? "Shërbimi OpenWA nuk përgjigjet."
        : `Sesioni WhatsApp nuk është gati (${status}) edhe pas rinisjes automatike.`,
    );
  }
}

export async function reconcileWebhooks() {
  if (!openwaConfigured()) return;
  for (const ch of await openwaChannels()) await ensureWebhook(ch.externalId);
}
