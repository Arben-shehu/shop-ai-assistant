"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notify";
import { requireAdmin } from "@/lib/session";
import type { ActionResult } from "@/components/admin/types";
import { idSchema, zodError } from "../_lib/accounts";

const replySchema = z.object({
  ticketId: idSchema,
  body: z.string().trim().min(2, "Mesazhi është shumë i shkurtër.").max(5000, "Mesazhi është shumë i gjatë."),
});

export async function adminReplyToTicket(input: z.input<typeof replySchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { ticketId, body } = parsed.data;

  const ticket = await prisma.helpTicket.findUnique({ where: { id: ticketId }, select: { id: true, organizationId: true, subject: true, status: true } });
  if (!ticket) return { ok: false, error: "Tiketa nuk u gjet." };

  await prisma.$transaction([
    prisma.helpTicketMessage.create({ data: { ticketId, authorId: session.user.id, body } }),
    prisma.helpTicket.update({ where: { id: ticketId }, data: { status: ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status } }),
  ]);
  // Notify the ticket's shop (not the admin's active shop).
  await notify(ticket.organizationId, {
    type: "TICKET_REPLY",
    title: "Përgjigje e re nga mbështetja",
    body: ticket.subject,
    link: `/help/${ticket.id}`,
  });
  await logActivity({ orgId: ticket.organizationId, userId: session.user.id, action: "ticket.admin_replied", entityType: "help_ticket", entityId: ticketId });
  revalidatePath(`/admin/help/${ticketId}`);
  revalidatePath("/admin/help");
  revalidatePath(`/help/${ticketId}`);
  return { ok: true };
}

const updateSchema = z.object({
  ticketId: idSchema,
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

export async function adminUpdateTicket(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { ticketId, status, priority } = parsed.data;
  if (!status && !priority) return { ok: false, error: "Asgjë për të ndryshuar." };

  const ticket = await prisma.helpTicket.findUnique({ where: { id: ticketId }, select: { organizationId: true } });
  if (!ticket) return { ok: false, error: "Tiketa nuk u gjet." };
  await prisma.helpTicket.update({ where: { id: ticketId }, data: { status, priority } });
  await logActivity({ orgId: ticket.organizationId, userId: session.user.id, action: "ticket.updated", entityType: "help_ticket", entityId: ticketId, meta: { status: status ?? null, priority: priority ?? null } });
  revalidatePath(`/admin/help/${ticketId}`);
  revalidatePath("/admin/help");
  revalidatePath(`/help/${ticketId}`);
  return { ok: true };
}
