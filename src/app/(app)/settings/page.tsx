import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { getShopSettings } from "@/lib/shop-settings";
import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { InventorySourceCard } from "@/components/settings/inventory-source-card";

export default async function SettingsPage() {
  const { orgId, platformAdmin } = await requireOrg({ minRole: "admin" });
  const settings = await getShopSettings(orgId);
  const source = platformAdmin
    ? await prisma.inventorySource.findUnique({
        where: { organizationId: orgId },
        select: {
          dialect: true,
          query: true,
          customerQuery: true,
          historyQuery: true,
          orderStatusQuery: true,
          columns: true,
          lastError: true,
          lastCheckedAt: true,
        },
      })
    : null;
  return (
    <>
      <PageHeader title="Cilësimet" description="Të dhënat e dyqanit dhe sjellja e asistentit AI." />
      <SettingsForm initial={settings} />
      {platformAdmin && (
        <div className="mt-6">
          <InventorySourceCard initial={source && { ...source, lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null }} />
        </div>
      )}
    </>
  );
}
