import type { OrderStatus } from "@/generated/prisma/enums";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OrderOpenButton, OrderRow } from "./order-sheet";
import { OrderStatusBadge } from "./order-status-badge";

export type OrderRowData = {
  id: string;
  number: number;
  customerName: string | null;
  customerPhone: string | null;
  itemCount: number;
  totalLabel: string;
  status: OrderStatus;
  channelLabel: string | null;
  createdRelative: string;
  createdLabel: string;
};

/** Pure render (also used with sample rows as the loading skeleton). */
export function OrdersTable({ rows }: { rows: OrderRowData[] }) {
  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-20 pl-4">Nr.</TableHead>
          <TableHead>Klienti</TableHead>
          <TableHead className="text-right">Artikuj</TableHead>
          <TableHead className="text-right">Totali</TableHead>
          <TableHead>Statusi</TableHead>
          <TableHead>Kanali</TableHead>
          <TableHead className="pr-4">Krijuar</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((o) => (
          <OrderRow key={o.id} id={o.id}>
            <TableCell className="pl-4">
              <OrderOpenButton id={o.id}>#{o.number}</OrderOpenButton>
            </TableCell>
            <TableCell>
              <div className="flex flex-col">
                <span className="font-medium">{o.customerName ?? "Pa emër"}</span>
                {o.customerPhone && <span className="text-muted-foreground text-xs">{o.customerPhone}</span>}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{o.itemCount}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{o.totalLabel}</TableCell>
            <TableCell>
              <OrderStatusBadge status={o.status} />
            </TableCell>
            <TableCell className="text-muted-foreground">{o.channelLabel ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground pr-4" title={o.createdLabel}>
              {o.createdRelative}
            </TableCell>
          </OrderRow>
        ))}
      </TableBody>
    </Table>
  );
}

export const SAMPLE_ORDER_ROWS: OrderRowData[] = Array.from({ length: 8 }, (_, i) => ({
  id: `sample-${i}`,
  number: 1000 + i,
  customerName: "Emri Mbiemri",
  customerPhone: "+355 69 000 0000",
  itemCount: 2,
  totalLabel: "1299,99 €",
  status: "PENDING",
  channelLabel: "WhatsApp",
  createdRelative: "para 2 orësh",
  createdLabel: "",
}));
