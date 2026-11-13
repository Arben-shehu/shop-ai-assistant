import "server-only";
import type { Channel } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/events";
import { getAdapter } from "@/lib/channels";
import { getSession, openwaConfigured } from "@/lib/channels/openwa";
import { InvalidRecipientError } from "@/lib/channels/phone";
import { markChannelConnected, markChannelError } from "@/lib/channels/status";

/**
 * Outbox worker: delivers OUTBOUND messages that sendToCustomer() queued (Message.status = QUEUED).
 * Ported from SunEasy Notification/Services/WhatsAppQueueWorker.cs + WhatsAppRateLimiter.cs + WhatsAppSender.cs:
 *  - atomic claim QUEUED -> SENDING (updateMany, 1 row affected wins) => safe with several app instances
 *  - lease: a claimed row gets nextAttemptAt = now + 2 min; SENDING rows past it are reclaimed (crashed instance)
 *  - retry with backoff 1 / 5 / 25 min, FAILED after 3 attempts + Channel ERROR + CHANNEL_ERROR notification (once)
 *  - sends are serialised per channel and per chat (an older unsent message of the chat blocks newer ones)
 *  - OpenWA only (anti-ban, unofficial gateway): session-ready gate, 1-3 s jitter, daily cap, burst pause.
 *    Deferrals never consume an attempt. Meta / Instagram get claim + retry only.
 * SunEasy removed quiet hours and long cooldowns (transactional latency); so do we.
 */

/** Anti-ban limits per OpenWA channel (agreed defaults; SunEasy used 250-1000/day, 50/h for notifications). */
export const OPENWA_LIMITS = {
  dailyCap: 1000, // successful sends per UTC day
  burstPerHour: 120, // successful sends in the trailing hour that trigger a pause
  burstPauseMs: 10 * 60_000,
  jitterMinMs: 1_000,
  jitterMaxMs: 3_000,
} as const;

const POLL_MS = 2_000;
const LEASE_MS = 2 * 60_000; // keep every send timeout well below this
const MAX_ATTEMPTS = 3;
const BACKOFF_MIN = [1, 5, 25];
const SESSION_NOT_READY_DEFER_MS = 30_000;
const STALE_MS = 60 * 60_000; // SunEasy DefaultMaxAge: never deliver a reply that waited > 1 h for the session

type OutboxState = {
  started: boolean;
  ticking: boolean;
  again: boolean;
  busy: Set<string>;
  /** Latest tick implementation: the interval calls through this so dev hot-reloads take effect. */
  tick?: () => Promise<void>;
  lastErrorLog: number;
  /** Interval of a loop started by an older build of this module (dev hot reload); replaced on load. */
  timer?: ReturnType<typeof setInterval>;
};
const g = globalThis as unknown as { shopOutbox?: OutboxState };
const state = (g.shopOutbox ??= { started: false, ticking: false, again: false, busy: new Set(), lastErrorLog: 0 });
if (state.timer) {
  clearInterval(state.timer);
  Object.assign(state, { timer: undefined, started: false, ticking: false, lastErrorLog: 0 });
}

/** Idempotent: starts the polling loop once per process (instrumentation register() and first enqueue). */
export function startOutbox() {
  state.tick = tick;
  if (state.started) return;
  state.started = true;
  setInterval(() => void state.tick?.(), POLL_MS).unref?.();
  console.log("[outbox] worker started");
}

/** Wake the worker now (called right after enqueue so replies don't wait for the next poll). */
export function kickOutbox() {
  startOutbox();
  void tick();
}

async function tick() {
  if (state.ticking) {
    state.again = true;
    return;
  }
  state.ticking = true;
  try {
    do {
      state.again = false;
      await drainOnce();
    } while (state.again);
  } catch (e) {
    // Throttled: a persistent failure (DB down) must not flood the log every 2 s.
    if (Date.now() - state.lastErrorLog > 60_000) {
      state.lastErrorLog = Date.now();
      console.error("[outbox] tick failed:", e instanceof Error ? e.message.slice(0, 300) : e);
    }
  } finally {
    state.ticking = false;
  }
}

async function drainOnce() {
  const now = new Date();
  // Reclaim orphaned claims (instance crashed mid-send).
  await prisma.message.updateMany({
    where: { status: "SENDING", nextAttemptAt: { lte: now } },
    data: { status: "QUEUED" },
  });
  const due = await prisma.message.findMany({
    where: { direction: "OUTBOUND", status: "QUEUED", nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, conversation: { select: { channelId: true } } },
  });
  const byChannel = new Map<string, string[]>();
  for (const m of due) {
    const list = byChannel.get(m.conversation.channelId) ?? [];
    list.push(m.id);
    byChannel.set(m.conversation.channelId, list);
  }
  for (const [channelId, ids] of byChannel) {
    if (state.busy.has(channelId)) continue; // one sequential sender per channel
    state.busy.add(channelId);
    void processChannel(channelId, ids)
      .catch((e) => console.error(`[outbox] channel ${channelId} failed:`, e instanceof Error ? e.message : e))
      .finally(() => state.busy.delete(channelId));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function defer(ids: string[], ms: number) {
  await prisma.message.updateMany({
    where: { id: { in: ids }, status: "QUEUED" },
    data: { nextAttemptAt: new Date(Date.now() + ms) },
  });
}

async function sentCount(channelId: string, since: Date) {
  return prisma.message.count({
    where: { direction: "OUTBOUND", status: "SENT", createdAt: { gte: since }, conversation: { channelId } },
  });
}

/** Port of WhatsAppRateLimiter.AcquireSendSlotAsync: null = refuse (defer by ms), otherwise jitter to wait. */
async function acquireSlot(channelId: string): Promise<{ deferMs: number } | { waitMs: number }> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  if ((await sentCount(channelId, midnight)) >= OPENWA_LIMITS.dailyCap) {
    console.warn(`[outbox] daily cap reached for channel ${channelId}; deferring to next UTC day`);
    return { deferMs: midnight.getTime() + 86_400_000 - Date.now() + 60_000 };
  }
  if ((await sentCount(channelId, new Date(Date.now() - 3_600_000))) >= OPENWA_LIMITS.burstPerHour) {
    console.warn(`[outbox] burst threshold hit for channel ${channelId}; pausing ${OPENWA_LIMITS.burstPauseMs / 60_000} min`);
    return { deferMs: OPENWA_LIMITS.burstPauseMs };
  }
  const { jitterMinMs: a, jitterMaxMs: b } = OPENWA_LIMITS;
  return { waitMs: a + Math.floor(Math.random() * (b - a + 1)) };
}

async function processChannel(channelId: string, ids: string[]) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return;
  if (!channel.isActive) {
    await prisma.message.updateMany({
      where: { id: { in: ids }, status: "QUEUED" },
      data: { status: "FAILED", error: "Kanali është i çaktivizuar", nextAttemptAt: null },
    });
    await publishMessages(channel.organizationId, ids);
    return;
  }

  if (channel.type === "WHATSAPP_OPENWA") {
    // Session-ready gate (WhatsAppQueueWorker): never hand messages to a session that isn't ready, or the
    // gateway buffers them and flushes a stale backlog on reconnect. The health monitor restarts it.
    // Unconfigured gateway / unknown session (404) are real failures: they take the normal retry -> FAILED path.
    // Gateway down or session not ready: wait (no attempt used), but drop replies older than STALE_MS
    // (WhatsAppQueueWorker staleness gate) so a long outage never flushes hours-old replies on reconnect.
    let waiting = false;
    if (openwaConfigured()) {
      const session = await getSession(channel.externalId).catch(() => undefined);
      waiting = session === undefined || (session !== null && session.status !== "ready");
    }
    if (waiting) {
      const stale = await prisma.message.updateMany({
        where: { id: { in: ids }, status: "QUEUED", createdAt: { lt: new Date(Date.now() - STALE_MS) } },
        data: { status: "FAILED", error: "Nuk u dërgua: WhatsApp nuk ishte i lidhur për më shumë se 1 orë", nextAttemptAt: null },
      });
      if (stale.count) {
        await markChannelError(channel, "Mesazhet nuk po dërgohen: sesioni WhatsApp nuk është i lidhur.");
        await publishMessages(channel.organizationId, ids);
      }
      await defer(ids, SESSION_NOT_READY_DEFER_MS);
      return;
    }
  }

  for (const id of ids) {
    const msg = await prisma.message.findUnique({
      where: { id },
      select: {
        id: true,
        text: true,
        status: true,
        createdAt: true,
        conversationId: true,
        conversation: { select: { customer: { select: { externalId: true } } } },
      },
    });
    if (!msg || msg.status !== "QUEUED") continue;

    // Per-chat serialisation: keep order; an older undelivered message of this chat goes first.
    const older = await prisma.message.findFirst({
      where: {
        conversationId: msg.conversationId,
        direction: "OUTBOUND",
        status: { in: ["QUEUED", "SENDING"] },
        createdAt: { lt: msg.createdAt },
      },
      select: { id: true },
    });
    if (older) continue;

    if (channel.type === "WHATSAPP_OPENWA") {
      const slot = await acquireSlot(channel.id);
      if ("deferMs" in slot) {
        await defer(ids, slot.deferMs);
        return;
      }
      await sleep(slot.waitMs);
    }

    // Atomic claim: exactly one instance wins.
    const claimed = await prisma.message.updateMany({
      where: { id, status: "QUEUED" },
      data: { status: "SENDING", attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + LEASE_MS) },
    });
    if (claimed.count === 0) continue;
    const attempts = (await prisma.message.findUnique({ where: { id }, select: { attempts: true } }))?.attempts ?? 1;

    await deliver(channel, msg.id, msg.conversationId, msg.conversation.customer.externalId, msg.text ?? "", attempts);
  }
}

async function deliver(channel: Channel, id: string, conversationId: string, to: string, text: string, attempts: number) {
  try {
    const { externalId } = await getAdapter(channel.type).sendText(channel, to, text);
    await prisma.message
      .update({ where: { id }, data: { status: "SENT", externalId: externalId ?? null, error: null, nextAttemptAt: null } })
      .catch(() =>
        // (conversationId, externalId) collision is harmless: keep the row SENT without the provider id.
        prisma.message.update({ where: { id }, data: { status: "SENT", error: null, nextAttemptAt: null } }),
      );
    if (channel.status !== "CONNECTED" && channel.type !== "WHATSAPP_OPENWA") await markChannelConnected(channel);
  } catch (e) {
    const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const permanent = e instanceof InvalidRecipientError;
    if (permanent || attempts >= MAX_ATTEMPTS) {
      await prisma.message.update({ where: { id }, data: { status: "FAILED", error: reason, nextAttemptAt: null } });
      console.error(`[outbox] message ${id} failed permanently (${attempts} attempts): ${reason}`);
      if (!permanent) await markChannelError(channel, `Dërgimi i mesazhit dështoi: ${reason}`);
    } else {
      const minutes = BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1];
      await prisma.message.update({
        where: { id },
        data: { status: "QUEUED", error: reason, nextAttemptAt: new Date(Date.now() + minutes * 60_000) },
      });
      console.warn(`[outbox] message ${id} attempt ${attempts} failed, retry in ${minutes} min: ${reason}`);
    }
  }
  publish(channel.organizationId, { type: "message", conversationId });
}

async function publishMessages(orgId: string, ids: string[]) {
  const convs = await prisma.message.findMany({ where: { id: { in: ids } }, select: { conversationId: true }, distinct: ["conversationId"] });
  for (const c of convs) publish(orgId, { type: "message", conversationId: c.conversationId });
}

