import { format } from "date-fns";
import { sq } from "date-fns/locale";
import { PageHeader } from "@/components/page-header";
import { BusinessesTable, type BusinessRow } from "@/components/admin/businesses-table";
import { CreateBusinessDialog } from "@/components/admin/create-business-dialog";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export default async function BusinessesPage() {
  const session = await requireAdmin();
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      members: { where: { role: "owner" }, select: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } },
      channels: { select: { status: true, isActive: true } },
      _count: { select: { members: true, products: true } },
    },
  });

  const rows: BusinessRow[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    owners: o.members.map((m) => m.user.email),
    members: o._count.members,
    products: o._count.products,
    channels: o.channels.length,
    channelsConnected: o.channels.filter((c) => c.isActive && c.status === "CONNECTED").length,
    channelsError: o.channels.filter((c) => c.status === "ERROR").length,
    createdAt: format(o.createdAt, "d MMM yyyy", { locale: sq }),
    active: o.id === session.session.activeOrganizationId,
  }));

  return (
    <>
      <PageHeader
        title="Bizneset"
        description="Të gjithë dyqanet në platformë. Hyni në një dyqan për ta menaxhuar si administrator."
        actions={<CreateBusinessDialog />}
      />
      <BusinessesTable rows={rows} />
    </>
  );
}
