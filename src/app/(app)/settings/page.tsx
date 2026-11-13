import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { getShopSettings } from "@/lib/shop-settings";
import { requireOrg } from "@/lib/session";

export default async function SettingsPage() {
  const { orgId } = await requireOrg({ minRole: "admin" });
  const settings = await getShopSettings(orgId);
  return (
    <>
      <PageHeader title="Cilësimet" description="Të dhënat e dyqanit dhe sjellja e asistentit AI." />
      <SettingsForm initial={settings} />
    </>
  );
}
