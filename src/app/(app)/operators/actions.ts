"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { requireOrg } from "@/lib/session";
import type { ActionResult } from "@/components/admin/types";
import {
  addShopMember, createAccount, emailSchema, idSchema, nameSchema, passwordSchema, repointSessions, zodError,
} from "@/app/(app)/admin/_lib/accounts";

// Shop managers can grant operator or admin; ownership is only assigned by the platform admin.
const assignableRole = z.enum(["member", "admin"]);

const addSchema = z.object({
  role: assignableRole,
  user: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), email: emailSchema }),
    z.object({ mode: z.literal("new"), name: nameSchema, email: emailSchema, password: passwordSchema }),
  ]),
});

export async function addOperator(input: z.input<typeof addSchema>): Promise<ActionResult> {
  const { orgId, user: actor, platformAdmin } = await requireOrg({ minRole: "admin" });
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { role, user } = parsed.data;
  // Attaching an existing account would let a shop pull in (and probe for) any user on the platform.
  if (user.mode === "existing" && !platformAdmin)
    return { ok: false, error: "Vetëm administratori i platformës mund të shtojë një përdorues ekzistues." };

  let userId: string;
  let created = false;
  if (user.mode === "existing") {
    const found = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
    if (!found) return { ok: false, error: "Nuk u gjet asnjë përdorues me këtë email." };
    userId = found.id;
  } else {
    // Owners aren't platform admins, so the account is created through the server path with role "user".
    const res = await createAccount({ name: user.name, email: user.email, password: user.password, role: "user" });
    if (!res.ok) return res;
    userId = res.userId;
    created = true;
  }

  if (await prisma.member.findFirst({ where: { organizationId: orgId, userId }, select: { id: true } }))
    return { ok: false, error: "Ky përdorues është tashmë anëtar i dyqanit." };

  try {
    await addShopMember(orgId, userId, role);
  } catch {
    if (created) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    return { ok: false, error: "Shtimi i operatorit dështoi." };
  }
  await logActivity({ orgId, userId: actor.id, action: "operator.added", entityType: "user", entityId: userId, meta: { role, newAccount: created } });
  revalidatePath("/operators");
  return { ok: true };
}

/** Loads a member of THIS shop and checks the actor may manage it. */
async function loadManageable(memberId: string) {
  const ctx = await requireOrg({ minRole: "admin" });
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId: ctx.orgId },
    select: { id: true, userId: true, role: true, user: { select: { email: true } } },
  });
  if (!member) return { ok: false, error: "Anëtari nuk u gjet." } as const;
  if (member.userId === ctx.user.id) return { ok: false, error: "Nuk mund të ndryshoni llogarinë tuaj këtu." } as const;
  if (member.role === "owner") {
    if (ctx.role !== "owner" && !ctx.platformAdmin) return { ok: false, error: "Vetëm pronari mund të ndryshojë një pronar." } as const;
    const owners = await prisma.member.count({ where: { organizationId: ctx.orgId, role: "owner" } });
    if (owners <= 1) return { ok: false, error: "Dyqani duhet të ketë të paktën një pronar." } as const;
  }
  return { ok: true, ctx, member } as const;
}

const roleSchema = z.object({ memberId: idSchema, role: assignableRole });

export async function changeOperatorRole(input: z.input<typeof roleSchema>): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  const r = await loadManageable(parsed.success ? parsed.data.memberId : "");
  if (!parsed.success) return zodError(parsed.error);
  if (!r.ok) return { ok: false, error: r.error };
  const { ctx, member } = r;

  await prisma.member.update({ where: { id: member.id }, data: { role: parsed.data.role } });
  await logActivity({ orgId: ctx.orgId, userId: ctx.user.id, action: "operator.role_changed", entityType: "user", entityId: member.userId, meta: { from: member.role, to: parsed.data.role } });
  revalidatePath("/operators");
  return { ok: true };
}

const removeSchema = z.object({ memberId: idSchema });

export async function removeOperator(input: z.input<typeof removeSchema>): Promise<ActionResult> {
  const parsed = removeSchema.safeParse(input);
  const r = await loadManageable(parsed.success ? parsed.data.memberId : "");
  if (!parsed.success) return zodError(parsed.error);
  if (!r.ok) return { ok: false, error: r.error };
  const { ctx, member } = r;

  await prisma.$transaction([
    prisma.member.delete({ where: { id: member.id } }),
    prisma.conversation.updateMany({ where: { organizationId: ctx.orgId, assigneeId: member.userId }, data: { assigneeId: null } }),
  ]);
  await repointSessions({ orgId: ctx.orgId, userId: member.userId });
  await logActivity({ orgId: ctx.orgId, userId: ctx.user.id, action: "operator.removed", entityType: "user", entityId: member.userId, meta: { email: member.user.email } });
  revalidatePath("/operators");
  return { ok: true };
}
