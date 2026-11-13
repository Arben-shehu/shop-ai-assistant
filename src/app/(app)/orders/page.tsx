import Link from "next/link";
import { SkeletonSuspense } from "skullet/react";
import { ShoppingCartIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ListPagination } from "@/components/orders/list-pagination";
import { LiveRefresh } from "@/components/orders/live-refresh";
import { OrderDetail } from "@/components/orders/order-detail";
import { OrderSheetProvider } from "@/components/orders/order-sheet";
import { ORDERS_PAGE_SIZE } from "@/components/orders/order-status";
import { OrdersTable, SAMPLE_ORDER_ROWS } from "@/components/orders/orders-table";
import { OrdersToolbar } from "@/components/orders/orders-toolbar";
import { getShopSettings } from "@/lib/shop-settings";
import { requireOrg } from "@/lib/session";
import { getOrderDetail, getOrderRows, getStatusCounts, parseOrderFilters, type OrderFilters } from "./data";

export const metadata = { title: "Porositë" };

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const { orgId } = await requireOrg();
  const sp = await searchParams;
  const filters = parseOrderFilters(sp);
  const { currency } = await getShopSettings(orgId);
  const [counts, detail] = await Promise.all([
    getStatusCounts(orgId, filters),
    filters.orderId ? getOrderDetail(orgId, filters.orderId, currency) : null,
  ]);

  return (
    <OrderSheetProvider orderId={detail?.id ?? null} detail={detail && <OrderDetail order={detail} />}>
      <LiveRefresh types={["order"]} />
      <PageHeader title="Porositë" description="Porositë e krijuara nga asistenti në WhatsApp dhe Instagram." />
      <OrdersToolbar status={filters.status} period={filters.period} counts={counts} />
      <SkeletonSuspense
        id="orders-list"
        label="Duke ngarkuar porositë"
        skeleton={
          <Card className="py-0">
            <OrdersTable rows={SAMPLE_ORDER_ROWS} />
          </Card>
        }
      >
        <OrdersList orgId={orgId} filters={filters} currency={currency} sp={sp} />
      </SkeletonSuspense>
    </OrderSheetProvider>
  );
}

async function OrdersList({
  orgId,
  filters,
  currency,
  sp,
}: {
  orgId: string;
  filters: OrderFilters;
  currency: string;
  sp: Record<string, string | string[] | undefined>;
}) {
  const { total, rows } = await getOrderRows(orgId, filters, ORDERS_PAGE_SIZE, currency);
  const filtered = Boolean(filters.status || filters.q || filters.period !== "all");

  if (rows.length === 0) {
    return (
      <Card>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShoppingCartIcon />
            </EmptyMedia>
            <EmptyTitle>{filtered || total > 0 ? "Asnjë porosi nuk u gjet" : "Ende nuk ka porosi"}</EmptyTitle>
            <EmptyDescription>
              {filtered || total > 0
                ? "Provoni një kërkim tjetër ose hiqni filtrat."
                : "Porositë shfaqen këtu sapo asistenti AI konfirmon një blerje me klientin."}
            </EmptyDescription>
          </EmptyHeader>
          {(filtered || total > 0) && (
            <EmptyContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/orders">Pastro filtrat</Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="py-0">
        <OrdersTable rows={rows} />
      </Card>
      <ListPagination pathname="/orders" params={sp} page={filters.page} pageSize={ORDERS_PAGE_SIZE} total={total} />
    </div>
  );
}
