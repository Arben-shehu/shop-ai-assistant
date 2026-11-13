import { format } from "date-fns";
import { sq } from "date-fns/locale";
import { PageHeader } from "@/components/page-header";
import { AddOperatorDialog } from "@/components/admin/add-operator-dialog";
import { OperatorsTable, type OperatorRow } from "@/components/admin/operators-table";
import { prisma } from "@/lib/prisma";
import { requireOrg } from "@/lib/session";

export default async function OperatorsPage() {
  const { orgId, user, role, platformAdmin } = await requireOrg({ minRole: "admin" });
  const members = await prisma.member.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true, banned: true } } },
  });
  const owners = members.filter((m) => m.role === "owner").length;
  const canManageOwners = role === "owner" || platformAdmin;

  const rows: OperatorRow[] = members.map((m) => ({
    id: m.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    banned: !!m.user.banned,
    joinedAt: format(m.createdAt, "d MMM yyyy", { locale: sq }),
    self: m.user.id === user.id,
    // Mirrors the server-side checks in actions.ts (which remain authoritative).
    locked: m.user.id === user.id || (m.role === "owner" && (!canManageOwners || owners <= 1)),
  }));

  return (
    <>
      <PageHeader
        title="Operatorët"
        description="Kush ka akses në këtë dyqan. Operatorët u përgjigjen klientëve; administratorët menaxhojnë edhe cilësimet."
        actions={<AddOperatorDialog allowExisting={platformAdmin} />}
      />
      <OperatorsTable rows={rows} />
    </>
  );
}
