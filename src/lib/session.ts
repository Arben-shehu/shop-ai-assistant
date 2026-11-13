import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type OrgRole = "owner" | "admin" | "member";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Any logged-in user. Redirects to /login otherwise. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Platform super-admin (user.role === "admin"). */
export async function requireAdmin() {
  const session = await requireUser();
  if (session.user.role !== "admin") redirect("/unauthorized");
  return session;
}

export const isPlatformAdmin = (user: { role?: string | null }) => user.role === "admin";

/**
 * Logged-in user acting inside a shop. Every shop query MUST filter by the returned orgId.
 * Platform admins may act in any shop; others must be a member of the active org.
 * `minRole: "admin"` = shop owner/admin only (operators are "member").
 */
export async function requireOrg(opts: { minRole?: "admin" } = {}) {
  const session = await requireUser();
  const orgId = session.session.activeOrganizationId;
  const platformAdmin = isPlatformAdmin(session.user);
  if (!orgId) redirect(platformAdmin ? "/admin" : "/no-organization");

  const member = await prisma.member.findFirst({ where: { organizationId: orgId, userId: session.user.id } });
  if (!member && !platformAdmin) redirect("/no-organization");
  const role = (member?.role ?? "owner") as OrgRole;
  if (opts.minRole === "admin" && role === "member" && !platformAdmin) redirect("/unauthorized");

  return { session, user: session.user, orgId, role, platformAdmin };
}
