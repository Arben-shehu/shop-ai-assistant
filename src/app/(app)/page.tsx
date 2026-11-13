import { SkeletonSuspense } from "skullet/react";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { requireOrg } from "@/lib/session";

async function ProductCount({ orgId }: { orgId: string }) {
  const n = await prisma.product.count({ where: { organizationId: orgId } });
  return <p className="text-sm">Produkte: {n}</p>;
}

// Placeholder: replaced by the dashboard agent.
export default async function DashboardPage() {
  const { orgId } = await requireOrg();
  return (
    <>
      <PageHeader title="Paneli" />
      <SkeletonSuspense id="dash-count" skeleton={<p className="text-sm">Produkte: 00</p>}>
        <ProductCount orgId={orgId} />
      </SkeletonSuspense>
    </>
  );
}
