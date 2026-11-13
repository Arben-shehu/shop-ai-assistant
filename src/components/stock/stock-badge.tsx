import { Badge } from "@/components/ui/badge";
import { LOW_STOCK } from "./product-schema";

export function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) return <Badge variant="destructive">Pa stok</Badge>;
  if (stock <= LOW_STOCK)
    return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">Stok i ulët</Badge>;
  return null;
}
