import { format } from "date-fns";
import { sq } from "date-fns/locale";
import { PageHeader } from "@/components/page-header";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { UsersTable, type UserRow } from "@/components/admin/users-table";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export default async function UsersPage() {
  const session = await requireAdmin();
  const [users, shops] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        createdAt: true,
        members: { select: { role: true, organization: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "admin" ? "admin" : "user",
    banned: !!u.banned,
    createdAt: format(u.createdAt, "d MMM yyyy", { locale: sq }),
    shops: u.members.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role })),
    self: u.id === session.user.id,
  }));

  return (
    <>
      <PageHeader
        title="Përdoruesit"
        description="Të gjitha llogaritë e platformës, rolet dhe dyqanet ku bëjnë pjesë."
        actions={<CreateUserDialog shops={shops} />}
      />
      <UsersTable rows={rows} />
    </>
  );
}
