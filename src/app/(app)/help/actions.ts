"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { requireOrg } from "@/lib/session";
import type { ActionResult } from "@/components/admin/types";
import { idSchema, zodError } from "@/app/(app)/admin/_lib/accounts";

const bodySchema = z.string().trim().min(2, "Mesazhi është shumë i shkurtër.").max(5000, "Mesazhi është shumë i gjatë.");

const createSchema = z.object({
  subject: z.string().trim().min(3, "Subjekti është shumë i shkurtër.").max(150),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  body: bodySchema,
});

export async function createTicket(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string }>> {
  const { orgId, user } = await requireOrg();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { subject, priority, body } = parsed.data;

  const ticket = await prisma.helpTicket.create({
    data: { organizationId: orgId, createdById: user.id, subject, priority, messages: { create: { authorId: user.id, body } } },
    select: { id: true },
  });
  await logActivity({ orgId, userId: user.id, action: "ticket.created", entityType: "help_ticket", entityId: ticket.id, meta: { subject, priority } });
  revalidatePath("/help");
  revalidatePath("/admin/help");
  return { ok: true, data: { id: ticket.id } };
}

const replySchema = z.object({ ticketId: idSchema, body: bodySchema });

export async function replyToTicket(input: z.input<typeof replySchema>): Promise<ActionResult> {
  const { orgId, user } = await requireOrg();
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { ticketId, body } = parsed.data;

  const ticket = await prisma.helpTicket.findFirst({ where: { id: ticketId, organizationId: orgId }, select: { id: true, status: true } });
  if (!ticket) return { ok: false, error: "Tiketa nuk u gjet." };
  if (ticket.status === "CLOSED") return { ok: false, error: "Tiketa është e mbyllur." };

  await prisma.$transaction([
    prisma.helpTicketMessage.create({ data: { ticketId, authorId: user.id, body } }),
    // A new message from the shop re-opens a resolved ticket; always bumps updatedAt.
    prisma.helpTicket.update({ where: { id: ticketId }, data: { status: ticket.status === "RESOLVED" ? "OPEN" : ticket.status } }),
  ]);
  await logActivity({ orgId, userId: user.id, action: "ticket.replied", entityType: "help_ticket", entityId: ticketId });
  revalidatePath(`/help/${ticketId}`);
  revalidatePath("/help");
  revalidatePath("/admin/help");
  return { ok: true };
}

const closeSchema = z.object({ ticketId: idSchema });

export async function closeTicket(input: z.input<typeof closeSchema>): Promise<ActionResult> {
  const { orgId, user } = await requireOrg();
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const res = await prisma.helpTicket.updateMany({
    where: { id: parsed.data.ticketId, organizationId: orgId, status: { not: "CLOSED" } },
    data: { status: "CLOSED" },
  });
  if (res.count === 0) return { ok: false, error: "Tiketa nuk u gjet." };
  await logActivity({ orgId, userId: user.id, action: "ticket.closed", entityType: "help_ticket", entityId: parsed.data.ticketId });
  revalidatePath(`/help/${parsed.data.ticketId}`);
  revalidatePath("/help");
  revalidatePath("/admin/help");
  return { ok: true };
}
