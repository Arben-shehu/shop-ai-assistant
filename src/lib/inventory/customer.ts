import "server-only";
import { prisma } from "@/lib/prisma";
import { erpSource, lookupErpClient } from "@/lib/inventory/source";
import { phoneKey } from "@/lib/inventory/sql";

/**
 * Who is writing, according to the shop's own ERP. The phone is the WhatsApp sender id the gateway gave us
 * (Customer.externalId) — never Customer.phone, which the model can change with save_customer_details, and never tool
 * input. Only exactly one matching ERP client counts as identified; web/Instagram visitors are always anonymous.
 */
export type ErpIdentity =
  | { kind: "off" } // the shop has no customer query
  | { kind: "anonymous"; reason: "web" | "not_whatsapp" | "no_phone" }
  | { kind: "none" }
  | { kind: "many"; count: number }
  | { kind: "one"; clientId: string; client: Record<string, string>; history: Record<string, string>[] | null };

/** Throws InventoryUnavailable when their DB fails. */
export async function identifyCustomer(orgId: string, conversationId: string, customerId: string): Promise<ErpIdentity> {
  if (!(await erpSource(orgId))) return { kind: "off" };
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: orgId, customerId },
    select: { channel: { select: { type: true } }, customer: { select: { externalId: true, name: true, address: true, externalRef: true } } },
  });
  if (!conv) return { kind: "anonymous", reason: "no_phone" };
  const type = conv.channel.type;
  if (type === "WEB") return { kind: "anonymous", reason: "web" };
  if (type !== "WHATSAPP_OPENWA" && type !== "WHATSAPP_META") return { kind: "anonymous", reason: "not_whatsapp" };
  const phone = phoneKey(conv.customer.externalId);
  if (!phone) return { kind: "anonymous", reason: "no_phone" };

  const r = await lookupErpClient(orgId, phone);
  if (!r) return { kind: "off" };
  const c = conv.customer;
  if (r.status !== "one") {
    if (c.externalRef) await prisma.customer.updateMany({ where: { id: customerId, organizationId: orgId }, data: { externalRef: null } });
    return r.status === "many" ? { kind: "many", count: r.count } : { kind: "none" };
  }
  const data: { externalRef?: string; name?: string; address?: string } = {};
  if (c.externalRef !== r.clientId) data.externalRef = r.clientId;
  if (!c.name?.trim() && r.client.name) data.name = r.client.name.slice(0, 100);
  if (!c.address?.trim() && r.client.address) data.address = r.client.address.slice(0, 300);
  if (Object.keys(data).length) await prisma.customer.updateMany({ where: { id: customerId, organizationId: orgId }, data });
  return { kind: "one", clientId: r.clientId, client: r.client, history: r.history };
}
