import type { Metadata } from "next";
import { SkeletonSuspense } from "skullet/react";
import { PageHeader } from "@/components/page-header";
import { requireOrg } from "@/lib/session";
import { RangePicker, parseRange } from "@/components/analytics/range-picker";
import {
  AnalyticsKpiTiles,
  AnalyticsKpis,
  ChannelSection,
  HandlingSection,
  ListCardSkeleton,
  OverTimeCard,
  OverTimeSection,
  SAMPLE_ANALYTICS_KPIS,
  StatusSection,
  TopProductsSection,
} from "@/components/analytics/sections";

export const metadata: Metadata = { title: "Analitika" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const { orgId } = await requireOrg();
  const days = parseRange((await searchParams).range);
  const p = { orgId, days };
  return (
    <>
      <PageHeader title="Analitika" description={`Shitjet dhe bisedat e ${days} ditëve të fundit`} actions={<RangePicker value={days} />} />
      <SkeletonSuspense id="an-kpis" skeleton={<AnalyticsKpiTiles k={SAMPLE_ANALYTICS_KPIS} />}>
        <AnalyticsKpis {...p} />
      </SkeletonSuspense>
      <SkeletonSuspense id="an-time" skeleton={<OverTimeCard data={null} />}>
        <OverTimeSection {...p} />
      </SkeletonSuspense>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <SkeletonSuspense id="an-status" skeleton={<ListCardSkeleton title="Porositë sipas statusit" />}>
          <StatusSection {...p} />
        </SkeletonSuspense>
        <SkeletonSuspense id="an-handling" skeleton={<ListCardSkeleton title="AI kundrejt operatorit" rows={2} />}>
          <HandlingSection {...p} />
        </SkeletonSuspense>
        <SkeletonSuspense id="an-qty" skeleton={<ListCardSkeleton title="Produktet më të shitura (sasi)" />}>
          <TopProductsSection {...p} by="qty" />
        </SkeletonSuspense>
        <SkeletonSuspense id="an-rev" skeleton={<ListCardSkeleton title="Produktet më të shitura (të ardhura)" />}>
          <TopProductsSection {...p} by="revenue" />
        </SkeletonSuspense>
        <SkeletonSuspense id="an-chan" skeleton={<ListCardSkeleton title="Bisedat sipas kanalit" rows={2} />}>
          <ChannelSection {...p} />
        </SkeletonSuspense>
      </div>
    </>
  );
}
