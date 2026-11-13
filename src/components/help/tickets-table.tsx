import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { sq } from "date-fns/locale";
import { MessageSquare } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TicketPriorityBadge, TicketStatusBadge, type TicketPriorityKey, type TicketStatusKey } from "./ticket-badges";

export type TicketRow = {
  id: string;
  subject: string;
  status: TicketStatusKey;
  priority: TicketPriorityKey;
  updatedAt: Date;
  messages: number;
  shopName?: string;
  createdBy: string;
};

/** Server component: list of tickets linking to `${hrefBase}/<id>`. */
export function TicketsTable({ rows, hrefBase, showShop = false }: { rows: TicketRow[]; hrefBase: string; showShop?: boolean }) {
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subjekti</TableHead>
            {showShop && <TableHead className="hidden md:table-cell">Dyqani</TableHead>}
            <TableHead className="hidden sm:table-cell">Prioriteti</TableHead>
            <TableHead>Statusi</TableHead>
            <TableHead className="hidden lg:table-cell">Përditësuar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id} className="relative">
              <TableCell className="max-w-[16rem] sm:max-w-md">
                <Link href={`${hrefBase}/${t.id}`} className="block truncate font-medium after:absolute after:inset-0 hover:underline">
                  {t.subject}
                </Link>
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span className="truncate">{showShop ? t.shopName : t.createdBy}</span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="size-3" aria-hidden /> {t.messages}
                  </span>
                </div>
              </TableCell>
              {showShop && <TableCell className="hidden md:table-cell">{t.shopName}</TableCell>}
              <TableCell className="hidden sm:table-cell">
                <TicketPriorityBadge priority={t.priority} />
              </TableCell>
              <TableCell>
                <TicketStatusBadge status={t.status} />
              </TableCell>
              <TableCell className="text-muted-foreground hidden lg:table-cell">
                {formatDistanceToNow(t.updatedAt, { addSuffix: true, locale: sq })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
