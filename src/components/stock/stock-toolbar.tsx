"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchInput } from "@/components/orders/search-input";
import { useUrlParams } from "@/components/orders/use-url-params";
import { STOCK_FILTERS, type StockFilter } from "./product-schema";

export function StockToolbar({ categories, category, filter }: { categories: string[]; category: string | null; filter: StockFilter }) {
  const { setParams } = useUrlParams();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <SearchInput placeholder="Kërko sipas emrit, SKU ose markës" className="sm:max-w-sm" />
      <Select value={category ?? "all"} onValueChange={(v) => setParams({ category: v === "all" ? null : v })}>
        <SelectTrigger className="w-full sm:w-48" aria-label="Kategoria">
          <SelectValue>{category ?? "Të gjitha kategoritë"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Të gjitha kategoritë</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filter} onValueChange={(v) => setParams({ filter: v === "all" ? null : v })}>
        <SelectTrigger className="w-full sm:w-44" aria-label="Gjendja e stokut">
          <SelectValue>{filter === "all" ? "Çdo gjendje" : STOCK_FILTERS[filter]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(STOCK_FILTERS).map(([k, label]) => (
            <SelectItem key={k} value={k}>
              {k === "all" ? "Çdo gjendje" : label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
