import Link from "next/link";
import { SkeletonSuspense } from "skullet/react";
import { PackageIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ListPagination } from "@/components/orders/list-pagination";
import { LiveRefresh } from "@/components/orders/live-refresh";
import { NewProductButton } from "@/components/stock/product-actions";
import { PRODUCTS_PAGE_SIZE } from "@/components/stock/product-schema";
import { ProductsTable, SAMPLE_PRODUCT_ROWS } from "@/components/stock/products-table";
import { SAMPLE_SUMMARY, StockSummary } from "@/components/stock/stock-summary";
import { StockToolbar } from "@/components/stock/stock-toolbar";
import { getShopSettings } from "@/lib/shop-settings";
import { requireOrg } from "@/lib/session";
import { getProductFacets, getProductRows, getStockSummary, parseStockFilters, type StockFilters } from "./data";

export const metadata = { title: "Magazina" };

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  const { orgId, role, platformAdmin } = await requireOrg();
  const canManage = platformAdmin || role !== "member";
  const sp = await searchParams;
  const filters = parseStockFilters(sp);
  const [{ currency }, facets] = await Promise.all([getShopSettings(orgId), getProductFacets(orgId)]);

  return (
    <>
      {/* New orders decrement stock. */}
      <LiveRefresh types={["order"]} />
      <PageHeader
        title="Magazina"
        description={canManage ? "Produktet, çmimet dhe stoku që asistenti u ofron klientëve." : "Produktet dhe stoku (vetëm për lexim)."}
        actions={canManage && <NewProductButton categories={facets.categories} brands={facets.brands} />}
      />
      <SkeletonSuspense id="stock-summary" label="Duke ngarkuar përmbledhjen" skeleton={<StockSummary data={SAMPLE_SUMMARY} />}>
        <SummaryCards orgId={orgId} currency={currency} />
      </SkeletonSuspense>
      <StockToolbar categories={facets.categories} category={filters.category} filter={filters.filter} />
      <SkeletonSuspense
        id="stock-list"
        label="Duke ngarkuar produktet"
        skeleton={
          <Card className="py-0">
            <ProductsTable rows={SAMPLE_PRODUCT_ROWS} canManage={canManage} />
          </Card>
        }
      >
        <ProductsList orgId={orgId} filters={filters} currency={currency} sp={sp} canManage={canManage} facets={facets} />
      </SkeletonSuspense>
    </>
  );
}

async function SummaryCards({ orgId, currency }: { orgId: string; currency: string }) {
  return <StockSummary data={await getStockSummary(orgId, currency)} />;
}

async function ProductsList({
  orgId,
  filters,
  currency,
  sp,
  canManage,
  facets,
}: {
  orgId: string;
  filters: StockFilters;
  currency: string;
  sp: Record<string, string | string[] | undefined>;
  canManage: boolean;
  facets: { categories: string[]; brands: string[] };
}) {
  const { total, rows } = await getProductRows(orgId, filters, PRODUCTS_PAGE_SIZE, currency);
  const filtered = Boolean(filters.q || filters.category || filters.filter !== "all");

  if (rows.length === 0) {
    const noneAtAll = !filtered && total === 0;
    return (
      <Card>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageIcon />
            </EmptyMedia>
            <EmptyTitle>{noneAtAll ? "Magazina është bosh" : "Asnjë produkt nuk u gjet"}</EmptyTitle>
            <EmptyDescription>
              {noneAtAll
                ? "Shtoni produktet që shitni, që asistenti t'i ofrojë te klientët."
                : "Provoni një kërkim tjetër ose hiqni filtrat."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {noneAtAll ? (
              canManage && <NewProductButton categories={facets.categories} brands={facets.brands} />
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href="/stock">Pastro filtrat</Link>
              </Button>
            )}
          </EmptyContent>
        </Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="py-0">
        <ProductsTable rows={rows} canManage={canManage} categories={facets.categories} brands={facets.brands} />
      </Card>
      <ListPagination pathname="/stock" params={sp} page={filters.page} pageSize={PRODUCTS_PAGE_SIZE} total={total} />
    </div>
  );
}
