import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ProductActions } from "./product-actions";
import type { ProductFormData } from "./product-schema";
import { StockBadge } from "./stock-badge";
import { ActiveSwitch, StockAdjuster } from "./stock-controls";

export type ProductRowData = { priceLabel: string; form: ProductFormData };

/** Pure render (also used with sample rows as the loading skeleton). Admin controls only when `canManage`. */
export function ProductsTable({
  rows,
  canManage,
  categories = [],
  brands = [],
}: {
  rows: ProductRowData[];
  canManage: boolean;
  categories?: string[];
  brands?: string[];
}) {
  return (
    <Table className="min-w-[860px]">
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Produkti</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>Kategoria</TableHead>
          <TableHead>Marka</TableHead>
          <TableHead className="text-right">Çmimi</TableHead>
          <TableHead className={canManage ? "text-center" : "text-right"}>Stoku</TableHead>
          <TableHead>{canManage ? "Aktiv" : "Statusi"}</TableHead>
          {canManage && (
            <TableHead className="w-12 pr-4">
              <span className="sr-only">Veprime</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ form: p, priceLabel }) => (
          <TableRow key={p.id} className={cn(!p.isActive && "text-muted-foreground")}>
            <TableCell className="max-w-72 pl-4">
              <span className="block truncate font-medium" title={p.name}>
                {p.name}
              </span>
            </TableCell>
            <TableCell className="font-mono text-xs">{p.sku}</TableCell>
            <TableCell>{p.category ?? "—"}</TableCell>
            <TableCell>{p.brand ?? "—"}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{priceLabel}</TableCell>
            <TableCell className={canManage ? "text-center" : "text-right"}>
              <div className={cn("flex items-center gap-2", canManage ? "justify-center" : "justify-end")}>
                <StockBadge stock={p.stock} />
                {canManage ? (
                  <StockAdjuster productId={p.id} name={p.name} stock={p.stock} />
                ) : (
                  <span className="font-medium tabular-nums">{p.stock}</span>
                )}
              </div>
            </TableCell>
            <TableCell>
              {canManage ? (
                <ActiveSwitch productId={p.id} name={p.name} isActive={p.isActive} />
              ) : p.isActive ? (
                <Badge variant="secondary">Aktiv</Badge>
              ) : (
                <Badge variant="outline">Joaktiv</Badge>
              )}
            </TableCell>
            {canManage && (
              <TableCell className="pr-4">
                <ProductActions product={p} categories={categories} brands={brands} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export const SAMPLE_PRODUCT_ROWS: ProductRowData[] = Array.from({ length: 10 }, (_, i) => ({
  priceLabel: "1299,99 €",
  form: {
    id: `sample-${i}`,
    name: "Lenovo ThinkPad X1 Carbon",
    sku: "LAP-LEN-X1C-G11",
    price: "1299.99",
    stock: 8,
    category: "Laptop",
    brand: "Lenovo",
    description: null,
    imageUrl: null,
    isActive: true,
    attributes: [],
  },
}));
