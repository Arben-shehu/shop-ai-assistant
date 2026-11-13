"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ChannelStatus } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrg } from "@/lib/session";
import { encryptJson } from "@/lib/crypto";
import { publish } from "@/lib/events";
import { logActivity } from "@/lib/activity";
import { loadChannelCredentials } from "@/lib/channels";
import {
  createSession, deleteSession, ensureWebhook, getQr, getSession, openwaConfigured, OpenwaError, startSession, stopSession,
} from "@/lib/channels/openwa";
import { testMetaWhatsApp } from "@/lib/channels/meta-whatsapp";
import { testInstagram } from "@/lib/channels/instagram";
import { markChannelConnected, markChannelError, saveChannelPhone, setChannelStatus } from "@/lib/channels/status";
import { isPlausiblePhone, normalizePhone } from "@/lib/channels/phone";
import { generateWidgetKey, MAX_ORIGINS, normalizeOrigin, webAllowedOrigins } from "@/lib/channels/web";
import { ensureChannelWorkers } from "@/lib/channels/workers";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Gabim i panjohur");
const idSchema = z.string().min(1).max(64);

function done(orgId: string, channelId: string) {
  publish(orgId, { type: "channel", channelId });
  revalidatePath("/channels");
}

async function ownChannel(orgId: string, id: unknown) {
  const channelId = idSchema.parse(id);
  const channel = await prisma.channel.findFirst({ where: { id: channelId, organizationId: orgId } });
  if (!channel) throw new Error("Kanali nuk u gjet");
  return channel;
}

// ---------------------------------------------------------------- OpenWA

const nameSchema = z.string().trim().min(2, "Emri është i shkurtër").max(60);

/**
 * Optional WhatsApp number typed by an admin (Meta display number, web widget override): "" -> null,
 * "069 123 4567" / "+355 69..." -> "35569...". Returns an error for anything that is not a plausible number.
 */
function parseOptionalPhone(input: unknown): { ok: true; phone: string | null } | { ok: false; error: string } {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: true, phone: null };
  if (raw.length > 30 || /[^\d\s+().-]/.test(raw)) return { ok: false, error: "Numri i WhatsApp duhet të përmbajë vetëm shifra" };
  const phone = normalizePhone(raw);
  if (!isPlausiblePhone(phone)) return { ok: false, error: "Numri i WhatsApp duket i pavlefshëm (p.sh. +355 69 123 4567)" };
  return { ok: true, phone };
}

export async function createOpenwaChannel(input: { name: string }): Promise<Result<{ channelId: string }>> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  const parsed = nameSchema.safeParse(input?.name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!openwaConfigured()) return { ok: false, error: "OpenWA nuk është konfiguruar në server (OPENWA_API_KEY)." };
  ensureChannelWorkers();
  try {
    const session = await createSession(`shop-${orgId.slice(0, 8)}-${randomBytes(4).toString("hex")}`.toLowerCase());
    const channel = await prisma.channel.create({
      data: {
        organizationId: orgId,
        type: "WHATSAPP_OPENWA",
        name: parsed.data,
        externalId: session.id,
        credentials: encryptJson({ kind: "openwa" }),
        status: "PENDING",
      },
    });
    // Webhooks are bound to the session id: register right away (the reconciler re-checks every 15 min).
    await ensureWebhook(session.id);
    // A slow/failed start must not orphan the row: the QR dialog's poll (re)starts the session anyway.
    await startSession(session.id).catch((e) => console.warn(`[channels] start ${session.id} failed: ${errMsg(e)}`));
    await logActivity({ orgId, userId: user.id, action: "channel.created", entityType: "Channel", entityId: channel.id, meta: { type: channel.type } });
    done(orgId, channel.id);
    return { ok: true, channelId: channel.id };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Polled by the QR dialog every few seconds: current status + fresh QR (it expires ~30 s). */
export async function pollOpenwaChannel(id: string): Promise<Result<{ status: ChannelStatus; qr: string | null; gateway: string }>> {
  const { orgId } = await requireOrg({ minRole: "admin" });
  try {
    const channel = await ownChannel(orgId, id);
    if (channel.type !== "WHATSAPP_OPENWA") return { ok: false, error: "Ky kanal nuk është OpenWA" };
    const s = await getSession(channel.externalId);
    if (!s) return { ok: false, error: "Sesioni nuk ekziston më në OpenWA. Provoni “Rilidh”." };
    if (s.status === "ready") {
      await saveChannelPhone(channel, s.phone);
      if (channel.status !== "CONNECTED") {
        await ensureWebhook(channel.externalId);
        await markChannelConnected(channel);
        revalidatePath("/channels");
      }
      return { ok: true, status: "CONNECTED", qr: null, gateway: s.status };
    }
    if (s.status === "disconnected" || s.status === "failed" || s.status === "created") await startSession(channel.externalId);
    // The gateway may still say "initializing" while a QR already exists: always ask (400 = none yet -> null).
    const qr = await getQr(channel.externalId);
    return { ok: true, status: channel.status, qr, gateway: s.status };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Restart the session (new QR if the phone was unlinked). Re-mints the session if the gateway lost it. */
export async function reconnectOpenwaChannel(id: string): Promise<Result> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  try {
    const channel = await ownChannel(orgId, id);
    if (channel.type !== "WHATSAPP_OPENWA") return { ok: false, error: "Ky kanal nuk është OpenWA" };
    let sessionId = channel.externalId;
    const s = await getSession(sessionId);
    if (!s) {
      sessionId = (await createSession(`shop-${orgId.slice(0, 8)}-${randomBytes(4).toString("hex")}`.toLowerCase())).id;
      await prisma.channel.update({ where: { id: channel.id }, data: { externalId: sessionId, status: "PENDING" } });
    } else if (s.status !== "ready") {
      if (!(await startSession(sessionId))) {
        await stopSession(sessionId);
        await startSession(sessionId);
      }
      if (channel.status !== "CONNECTED") await setChannelStatus(channel, "PENDING");
    }
    await ensureWebhook(sessionId);
    if (!s) await startSession(sessionId);
    await prisma.channel.update({ where: { id: channel.id }, data: { isActive: true } });
    await logActivity({ orgId, userId: user.id, action: "channel.reconnected", entityType: "Channel", entityId: channel.id });
    done(orgId, channel.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ---------------------------------------------------------------- Meta (WhatsApp Cloud API / Instagram)

const metaSchema = z.object({
  type: z.enum(["WHATSAPP_META", "INSTAGRAM"]),
  name: nameSchema,
  externalId: z.string().trim().regex(/^\d{5,30}$/, "ID duhet të përmbajë vetëm shifra"),
  accessToken: z.string().trim().min(20, "Token-i duket i pavlefshëm").max(2000),
  /** WHATSAPP_META only, optional: the display phone number (for the web widget's WhatsApp link). */
  phone: z.string().max(40).optional(),
});

export async function createMetaChannel(input: z.input<typeof metaSchema>): Promise<Result<{ channelId: string; info: string }>> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  const parsed = metaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { type, name, externalId, accessToken } = parsed.data;
  const phone = type === "WHATSAPP_META" ? parseOptionalPhone(parsed.data.phone) : ({ ok: true, phone: null } as const);
  if (!phone.ok) return phone;
  let info = "";
  let status: ChannelStatus = "PENDING";
  try {
    info = type === "WHATSAPP_META" ? await testMetaWhatsApp(externalId, accessToken) : await testInstagram(accessToken);
    status = "CONNECTED";
  } catch (e) {
    info = errMsg(e);
  }
  try {
    const channel = await prisma.channel.create({
      data: {
        organizationId: orgId,
        type,
        name,
        externalId,
        status,
        phone: phone.phone,
        credentials: encryptJson(type === "WHATSAPP_META" ? { kind: "meta_whatsapp", accessToken } : { kind: "instagram", accessToken }),
      },
    });
    await logActivity({ orgId, userId: user.id, action: "channel.created", entityType: "Channel", entityId: channel.id, meta: { type } });
    done(orgId, channel.id);
    return { ok: true, channelId: channel.id, info: status === "CONNECTED" ? info : `U ruajt, por testi dështoi: ${info}` };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Ky ID është lidhur tashmë me një kanal." };
    }
    return { ok: false, error: errMsg(e) };
  }
}

const tokenSchema = z.object({ id: idSchema, accessToken: metaSchema.shape.accessToken });

/** Replace the stored token (it is never sent back to the browser). */
export async function updateChannelToken(input: z.input<typeof tokenSchema>): Promise<Result> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  try {
    const channel = await ownChannel(orgId, parsed.data.id);
    if (channel.type === "WHATSAPP_OPENWA") return { ok: false, error: "OpenWA nuk përdor token" };
    if (channel.type === "WEB") return { ok: false, error: "Web chat nuk përdor token" };
    const kind = channel.type === "WHATSAPP_META" ? "meta_whatsapp" : "instagram";
    await prisma.channel.update({
      where: { id: channel.id },
      data: { credentials: encryptJson({ kind, accessToken: parsed.data.accessToken }) },
    });
    await logActivity({ orgId, userId: user.id, action: "channel.token_updated", entityType: "Channel", entityId: channel.id });
    done(orgId, channel.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** WHATSAPP_META: set/clear the display phone number (OpenWA numbers come from the gateway, never typed). */
export async function updateChannelPhone(input: { id: string; phone: string }): Promise<Result> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  const phone = parseOptionalPhone(input?.phone);
  if (!phone.ok) return phone;
  try {
    const channel = await ownChannel(orgId, input?.id);
    if (channel.type !== "WHATSAPP_META") return { ok: false, error: "Numri vendoset me dorë vetëm për WhatsApp zyrtar (Meta)" };
    await prisma.channel.update({ where: { id: channel.id }, data: { phone: phone.phone } });
    await logActivity({ orgId, userId: user.id, action: "channel.phone_updated", entityType: "Channel", entityId: channel.id, meta: { phone: phone.phone } });
    done(orgId, channel.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ---------------------------------------------------------------- Web chat widget

/** One origin per line / comma. Returns normalised, de-duplicated origins or the first invalid entry. */
function parseOrigins(input: unknown): { ok: true; origins: string[] } | { ok: false; error: string } {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,]+/) : [];
  const origins: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const o = normalizeOrigin(raw);
    if (!o) return { ok: false, error: `Adresë e pavlefshme: “${raw.trim().slice(0, 80)}” (p.sh. https://dyqani.al)` };
    if (!origins.includes(o)) origins.push(o);
  }
  if (origins.length > MAX_ORIGINS) return { ok: false, error: `Lejohen deri në ${MAX_ORIGINS} adresa` };
  return { ok: true, origins };
}

/**
 * WEB channels: Channel.phone is an optional per-widget WhatsApp override. Empty = the widget links to the
 * organization's first connected WhatsApp channel (see findWidgetChannel in src/lib/widget-api.ts).
 */
export async function createWebChannel(input: { name: string; origins: string; whatsapp?: string }): Promise<Result<{ channelId: string }>> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  const name = nameSchema.safeParse(input?.name);
  if (!name.success) return { ok: false, error: name.error.issues[0].message };
  const origins = parseOrigins(input?.origins);
  if (!origins.ok) return origins;
  const whatsapp = parseOptionalPhone(input?.whatsapp);
  if (!whatsapp.ok) return whatsapp;
  try {
    const channel = await prisma.channel.create({
      data: {
        organizationId: orgId,
        type: "WEB",
        name: name.data,
        externalId: generateWidgetKey(),
        credentials: encryptJson({ kind: "web", allowedOrigins: origins.origins }),
        phone: whatsapp.phone,
        status: "CONNECTED",
      },
    });
    await logActivity({ orgId, userId: user.id, action: "channel.created", entityType: "Channel", entityId: channel.id, meta: { type: "WEB" } });
    done(orgId, channel.id);
    return { ok: true, channelId: channel.id };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function updateWebOrigins(input: { id: string; origins: string; whatsapp?: string }): Promise<Result> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  const origins = parseOrigins(input?.origins);
  if (!origins.ok) return origins;
  const whatsapp = parseOptionalPhone(input?.whatsapp);
  if (!whatsapp.ok) return whatsapp;
  try {
    const channel = await ownChannel(orgId, input?.id);
    if (channel.type !== "WEB") return { ok: false, error: "Ky kanal nuk është Web chat" };
    await prisma.channel.update({
      where: { id: channel.id },
      data: { credentials: encryptJson({ kind: "web", allowedOrigins: origins.origins }), phone: whatsapp.phone },
    });
    await logActivity({
      orgId, userId: user.id, action: "channel.origins_updated", entityType: "Channel", entityId: channel.id,
      meta: { origins: origins.origins, whatsapp: whatsapp.phone },
    });
    done(orgId, channel.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ---------------------------------------------------------------- common

export async function testChannel(id: string): Promise<Result<{ info: string }>> {
  const { orgId } = await requireOrg({ minRole: "admin" });
  try {
    const channel = await ownChannel(orgId, id);
    let info: string;
    try {
      if (channel.type === "WHATSAPP_OPENWA") {
        const s = await getSession(channel.externalId);
        if (!s) throw new Error("Sesioni nuk ekziston në OpenWA");
        if (s.status !== "ready") throw new Error(`Sesioni nuk është gati (${s.status})`);
        await ensureWebhook(channel.externalId);
        await saveChannelPhone(channel, s.phone);
        info = s.phone ? `+${s.phone}${s.pushName ? ` · ${s.pushName}` : ""}` : "Gati";
      } else if (channel.type === "WEB") {
        // Nothing external to probe: the widget polls us.
        const n = webAllowedOrigins(channel).length;
        info = n ? `Widget-i është gati (${n} adresa të lejuara)` : "Widget-i është gati, por asnjë faqe nuk është lejuar ende";
      } else {
        const c = loadChannelCredentials(channel);
        if (!c || c.kind === "openwa" || c.kind === "web") throw new Error("Token-i mungon");
        info =
          channel.type === "WHATSAPP_META" ? await testMetaWhatsApp(channel.externalId, c.accessToken) : await testInstagram(c.accessToken);
      }
    } catch (e) {
      if (channel.status === "CONNECTED") await markChannelError(channel, errMsg(e));
      revalidatePath("/channels");
      return { ok: false, error: errMsg(e) };
    }
    await markChannelConnected(channel);
    revalidatePath("/channels");
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function setChannelActive(input: { id: string; active: boolean }): Promise<Result> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  const parsed = z.object({ id: idSchema, active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Të dhëna të pavlefshme" };
  try {
    const channel = await ownChannel(orgId, parsed.data.id);
    await prisma.channel.update({ where: { id: channel.id }, data: { isActive: parsed.data.active } });
    await logActivity({
      orgId, userId: user.id, action: parsed.data.active ? "channel.enabled" : "channel.disabled", entityType: "Channel", entityId: channel.id,
    });
    done(orgId, channel.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** OpenWA: stop the browser session (pairing is kept, "Rilidh" brings it back) and disable the channel. */
export async function disconnectChannel(id: string): Promise<Result> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  try {
    const channel = await ownChannel(orgId, id);
    if (channel.type === "WHATSAPP_OPENWA") {
      await stopSession(channel.externalId).catch((e) => {
        if (!(e instanceof OpenwaError && (e.status === 404 || e.status === 400))) throw e;
      });
    }
    await prisma.channel.update({ where: { id: channel.id }, data: { status: "DISCONNECTED", isActive: false } });
    await logActivity({ orgId, userId: user.id, action: "channel.disconnected", entityType: "Channel", entityId: channel.id });
    done(orgId, channel.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Deletes the channel and (cascade) its conversations and messages. OpenWA: the gateway session too. */
export async function deleteChannel(id: string): Promise<Result> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  try {
    const channel = await ownChannel(orgId, id);
    if (channel.type === "WHATSAPP_OPENWA" && openwaConfigured()) {
      await deleteSession(channel.externalId).catch((e) => console.warn(`[channels] delete session failed: ${errMsg(e)}`));
    }
    await prisma.channel.delete({ where: { id: channel.id } });
    await logActivity({
      orgId, userId: user.id, action: "channel.deleted", entityType: "Channel", entityId: channel.id, meta: { type: channel.type, name: channel.name },
    });
    done(orgId, channel.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
