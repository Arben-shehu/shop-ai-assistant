"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { requireAdmin } from "@/lib/session";
import type { ActionResult } from "@/components/admin/types";
import {
  addShopMember, createAccount, emailSchema, idSchema, nameSchema, passwordSchema, zodError,
} from "../_lib/accounts";

const platformRole = z.enum(["user", "admin"]);

const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: platformRole,
  shopId: idSchema.optional(),
  shopRole: z.enum(["owner", "admin", "member"]).default("member"),
});

export async function createUser(input: z.input<typeof createUserSchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { name, email, password, role, shopId, shopRole } = parsed.data;

  if (shopId && !(await prisma.organization.findUnique({ where: { id: shopId }, select: { id: true } })))
    return { ok: false, error: "Dyqani nuk u gjet." };

  const res = await createAccount({ name, email, password, role });
  if (!res.ok) return res;

  if (shopId) {
    try {
      await addShopMember(shopId, res.userId, shopRole);
    } catch {
      await prisma.user.delete({ where: { id: res.userId } }).catch(() => {});
      return { ok: false, error: "Përdoruesi nuk u shtua dot në dyqan." };
    }
  }
  await logActivity({ orgId: shopId, userId: session.user.id, action: "user.created", entityType: "user", entityId: res.userId, meta: { email, role, shopRole: shopId ? shopRole : null } });
  revalidatePath("/admin/users");
  return { ok: true };
}

const setRoleSchema = z.object({ userId: idSchema, role: platformRole });

export async function setPlatformRole(input: z.input<typeof setRoleSchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = setRoleSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { userId, role } = parsed.data;
  if (userId === session.user.id) return { ok: false, error: "Nuk mund të ndryshoni rolin tuaj." };
  try {
    await auth.api.setRole({ headers: await headers(), body: { userId, role } });
  } catch {
    return { ok: false, error: "Ndryshimi i rolit dështoi." };
  }
  await logActivity({ userId: session.user.id, action: "user.role_changed", entityType: "user", entityId: userId, meta: { role } });
  revalidatePath("/admin/users");
  return { ok: true };
}

const resetPasswordSchema = z.object({ userId: idSchema, password: passwordSchema });

export async function resetPassword(input: z.input<typeof resetPasswordSchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  try {
    await auth.api.setUserPassword({ headers: await headers(), body: { userId: parsed.data.userId, newPassword: parsed.data.password } });
  } catch {
    return { ok: false, error: "Ndryshimi i fjalëkalimit dështoi." };
  }
  await logActivity({ userId: session.user.id, action: "user.password_reset", entityType: "user", entityId: parsed.data.userId });
  return { ok: true };
}

const banSchema = z.object({ userId: idSchema, banned: z.boolean(), reason: z.string().trim().max(200).optional() });

export async function setBanned(input: z.input<typeof banSchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = banSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { userId, banned, reason } = parsed.data;
  if (userId === session.user.id) return { ok: false, error: "Nuk mund të bllokoni veten." };
  try {
    const h = await headers();
    if (banned) await auth.api.banUser({ headers: h, body: { userId, banReason: reason || undefined } });
    else await auth.api.unbanUser({ headers: h, body: { userId } });
  } catch {
    return { ok: false, error: "Veprimi dështoi." };
  }
  await logActivity({ userId: session.user.id, action: banned ? "user.banned" : "user.unbanned", entityType: "user", entityId: userId });
  revalidatePath("/admin/users");
  return { ok: true };
}

const deleteSchema = z.object({ userId: idSchema });

export async function deleteUser(input: z.input<typeof deleteSchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { userId } = parsed.data;
  if (userId === session.user.id) return { ok: false, error: "Nuk mund të fshini llogarinë tuaj." };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, members: { where: { role: "owner" }, select: { organizationId: true, organization: { select: { name: true } } } } },
  });
  if (!user) return { ok: false, error: "Përdoruesi nuk u gjet." };
  for (const m of user.members) {
    const owners = await prisma.member.count({ where: { organizationId: m.organizationId, role: "owner" } });
    if (owners <= 1)
      return { ok: false, error: `Është pronari i vetëm i “${m.organization.name}”. Caktoni një pronar tjetër ose fshini dyqanin.` };
  }
  try {
    await auth.api.removeUser({ headers: await headers(), body: { userId } });
  } catch {
    return { ok: false, error: "Fshirja dështoi." };
  }
  await logActivity({ userId: session.user.id, action: "user.deleted", entityType: "user", entityId: userId, meta: { email: user.email } });
  revalidatePath("/admin/users");
  revalidatePath("/admin/businesses");
  return { ok: true };
}

