"use client";
import type { OrderStatus } from "@/generated/prisma/enums";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ORDER_STATUSES, PERIODS, STATUS_LABEL, type Period } from "./order-status";
import { SearchInput } from "./search-input";
import { useUrlParams } from "./use-url-params";

export function OrdersToolbar({
  status,
  period,
  counts,
}: {
  status: OrderStatus | null;
  period: Period;
  counts: Partial<Record<OrderStatus | "all", number>>;
}) {
  const { setParams } = useUrlParams();

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <Tabs value={status ?? "all"} onValueChange={(v) => setParams({ status: v === "all" ? null : v })}>
          <TabsList aria-label="Filtro sipas statusit">
            {(["all", ...ORDER_STATUSES] as const).map((s) => (
              <TabsTrigger key={s} value={s} className="px-2.5">
                {s === "all" ? "Të gjitha" : STATUS_LABEL[s]}
                <span className="text-muted-foreground ml-0.5 text-xs tabular-nums">{counts[s] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput placeholder="Kërko sipas klientit, telefonit ose nr. të porosisë" className="sm:max-w-sm" />
        <Select value={period} onValueChange={(v) => setParams({ period: v === "all" ? null : v })}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Periudha">
            <SelectValue>{PERIODS[period]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PERIODS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
