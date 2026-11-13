import { SkeletonSuspense } from "skullet/react";
import { PageHeader } from "@/components/page-header";
import { requireOrg } from "@/lib/session";
import { LiveRefresh } from "@/components/dashboard/live-refresh";
import {
  AttentionList,
  AttentionSection,
  ChartCard,
  ChartSection,
  KpiSection,
  KpiTiles,
  LatestOrders,
  LatestOrdersSection,
  SAMPLE_CONVS,
  SAMPLE_KPIS,
  SAMPLE_ORDERS,
} from "@/components/dashboard/sections";

export default async function DashboardPage() {
  const { orgId } = await requireOrg();
  return (
    <>
      <LiveRefresh types={["order", "conversation", "message"]} />
      <PageHeader title="Paneli" description="Pamje e shpejtë e dyqanit sot" />
      <SkeletonSuspense id="dash-kpis" skeleton={<KpiTiles k={SAMPLE_KPIS} />}>
        <KpiSection orgId={orgId} />
      </SkeletonSuspense>
      <SkeletonSuspense id="dash-chart" skeleton={<ChartCard data={null} />}>
        <ChartSection orgId={orgId} />
      </SkeletonSuspense>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <SkeletonSuspense id="dash-orders" skeleton={<LatestOrders rows={SAMPLE_ORDERS} />}>
          <LatestOrdersSection orgId={orgId} />
        </SkeletonSuspense>
        <SkeletonSuspense id="dash-attention" skeleton={<AttentionList rows={SAMPLE_CONVS} />}>
          <AttentionSection orgId={orgId} />
        </SkeletonSuspense>
      </div>
    </>
  );
}
