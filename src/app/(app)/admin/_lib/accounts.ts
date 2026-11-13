import "server-only";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/components/admin/types";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Email i pavlefshëm."));
export const passwordSchema = z
  .string()
  .min(8, "Fjalëkalimi duhet të ketë të paktën 8 karaktere.")
  .max(128, "Fjalëkalimi është shumë i gjatë.");
export const nameSchema = z.string().trim().min(2, "Emri është shumë i shkurtër.").max(100);
export const slugSchema = z
  .string()
  .trim()
  .min(2, "Slug-u është shumë i shkurtër.")
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug-u lejon vetëm shkronja të vogla, numra dhe viza.");
export const idSchema = z.string().min(1).max(100);

/** First zod issue as a user-facing message. */
export function zodError(error: z.ZodError): ActionResult<never> {
  return { ok: false, error: error.issues[0]?.message ?? "Të dhëna të pavlefshme." };
}

/**
 * Create a credential account through Better Auth (hashes the password).
 * Called WITHOUT headers = server/system path, so the caller MUST have authorized first
 * (requireAdmin / requireOrg({ minRole: "admin" })).
 */
export async function createAccount(input: {
  name: string;
  email: string;
  password: string;
  role: "user" | "admin";
}): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const exists = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (exists) return { ok: false, error: "Ekziston tashmë një përdorues me këtë email." };
  try {
    const res = await auth.api.createUser({
      body: { name: input.name, email: input.email, password: input.password, role: input.role },
    });
    return { ok: true, userId: res.user.id };
  } catch {
    return { ok: false, error: "Krijimi i përdoruesit dështoi." };
  }
}

/** Add an existing user to a shop (server path, caller must have authorized). */
export async function addShopMember(orgId: string, userId: string, role: "owner" | "admin" | "member") {
  await auth.api.addMember({ body: { organizationId: orgId, userId, role } });
}

/**
 * Sessions pointing at an org the user can no longer use: move them to another shop the user
 * belongs to (or null). activeOrganizationId is not a foreign key, so this must be done by hand.
 */
export async function repointSessions(where: { orgId: string; userId?: string }) {
  const sessions = await prisma.session.findMany({
    where: { activeOrganizationId: where.orgId, ...(where.userId ? { userId: where.userId } : {}) },
    select: { id: true, userId: true },
  });
  for (const s of sessions) {
    const other = await prisma.member.findFirst({
      where: { userId: s.userId, organizationId: { not: where.orgId } },
      orderBy: { createdAt: "asc" },
      select: { organizationId: true },
    });
    await prisma.session.update({ where: { id: s.id }, data: { activeOrganizationId: other?.organizationId ?? null } });
  }
}

/** Point one session at a shop. Caller must have checked membership or platform-admin rights. */
export async function setSessionShop(sessionId: string, orgId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { activeOrganizationId: orgId } });
}
