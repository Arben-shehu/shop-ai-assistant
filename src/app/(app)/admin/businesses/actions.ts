"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { requireAdmin } from "@/lib/session";
import type { ActionResult } from "@/components/admin/types";
import {
  createAccount, emailSchema, idSchema, nameSchema, passwordSchema, repointSessions, setSessionShop, slugSchema, zodError,
} from "../_lib/accounts";

const createShopSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  owner: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), email: emailSchema }),
    z.object({ mode: z.literal("new"), name: nameSchema, email: emailSchema, password: passwordSchema }),
  ]),
});

export async function createShop(input: z.input<typeof createShopSchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = createShopSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { name, slug, owner } = parsed.data;

  if (await prisma.organization.findUnique({ where: { slug }, select: { id: true } }))
    return { ok: false, error: "Ky slug përdoret nga një dyqan tjetër." };

  let userId: string;
  let createdUser = false;
  if (owner.mode === "existing") {
    const user = await prisma.user.findUnique({ where: { email: owner.email }, select: { id: true } });
    if (!user) return { ok: false, error: "Nuk u gjet asnjë përdorues me këtë email." };
    userId = user.id;
  } else {
    const res = await createAccount({ name: owner.name, email: owner.email, password: owner.password, role: "user" });
    if (!res.ok) return res;
    userId = res.userId;
    createdUser = true;
  }

  let orgId: string;
  try {
    // No headers = system action: creates the org with `userId` as owner.
    const org = await auth.api.createOrganization({ body: { name, slug, userId } });
    if (!org) throw new Error("no org");
    orgId = org.id;
  } catch {
    if (createdUser) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    return { ok: false, error: "Krijimi i dyqanit dështoi." };
  }

  await logActivity({ orgId, userId: session.user.id, action: "shop.created", entityType: "organization", entityId: orgId, meta: { name, slug } });
  revalidatePath("/admin/businesses");
  revalidatePath("/admin/users");
  return { ok: true };
}

const updateShopSchema = z.object({ id: idSchema, name: nameSchema, slug: slugSchema });

export async function updateShop(input: z.input<typeof updateShopSchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = updateShopSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const { id, name, slug } = parsed.data;

  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
  if (!org) return { ok: false, error: "Dyqani nuk u gjet." };
  const clash = await prisma.organization.findFirst({ where: { slug, id: { not: id } }, select: { id: true } });
  if (clash) return { ok: false, error: "Ky slug përdoret nga një dyqan tjetër." };

  await prisma.organization.update({ where: { id }, data: { name, slug } });
  await logActivity({ orgId: id, userId: session.user.id, action: "shop.updated", entityType: "organization", entityId: id, meta: { name, slug } });
  revalidatePath("/", "layout");
  return { ok: true };
}

const deleteShopSchema = z.object({ id: idSchema, confirm: z.string() });

export async function deleteShop(input: z.input<typeof deleteShopSchema>): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = deleteShopSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const org = await prisma.organization.findUnique({ where: { id: parsed.data.id }, select: { id: true, name: true, slug: true } });
  if (!org) return { ok: false, error: "Dyqani nuk u gjet." };
  if (parsed.data.confirm.trim() !== org.slug) return { ok: false, error: "Konfirmimi nuk përputhet me slug-un e dyqanit." };

  await repointSessions({ orgId: org.id });
  // Order.customer is onDelete: Restrict, so orders go first; everything else cascades from the org.
  await prisma.$transaction([
    prisma.order.deleteMany({ where: { organizationId: org.id } }),
    prisma.organization.delete({ where: { id: org.id } }),
  ]);
  await logActivity({ userId: session.user.id, action: "shop.deleted", entityType: "organization", entityId: org.id, meta: { name: org.name, slug: org.slug } });
  revalidatePath("/", "layout");
  return { ok: true };
}

const enterShopSchema = z.object({ id: idSchema, to: z.enum(["/", "/channels"]).default("/") });

/** Platform admin: make this shop the active one for the current session, then open it. */
export async function enterShop(input: z.input<typeof enterShopSchema>) {
  const session = await requireAdmin();
  const parsed = enterShopSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const org = await prisma.organization.findUnique({ where: { id: parsed.data.id }, select: { id: true } });
  if (!org) return { ok: false, error: "Dyqani nuk u gjet." } satisfies ActionResult;

  // auth.api.setActiveOrganization requires membership; platform admins are usually not members.
  await setSessionShop(session.session.id, org.id);
  await logActivity({ orgId: org.id, userId: session.user.id, action: "shop.entered_by_admin", entityType: "organization", entityId: org.id });
  revalidatePath("/", "layout");
  redirect(parsed.data.to);
}
