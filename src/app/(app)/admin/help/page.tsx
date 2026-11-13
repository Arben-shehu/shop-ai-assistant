import Link from "next/link";
import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { STATUS_LABELS, type TicketStatusKey } from "@/components/help/ticket-badges";
import { TicketsTable } from "@/components/help/tickets-table";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

const FILTERS = ["ACTIVE", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "ALL"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<Filter, string> = { ACTIVE: "Aktive", ...STATUS_LABELS, ALL: "Të gjitha" };

export default async function AdminHelpPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  await requireAdmin();
  const raw = (await searchParams).status;
  const filter: Filter = FILTERS.includes(raw as Filter) ? (raw as Filter) : "ACTIVE";
  const where =
    filter === "ALL" ? {} : filter === "ACTIVE" ? { status: { in: ["OPEN", "IN_PROGRESS"] as TicketStatusKey[] } } : { status: filter };

  const [tickets, counts] = await Promise.all([
    prisma.helpTicket.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      select: {
        id: true, subject: true, status: true, priority: true, updatedAt: true,
        organization: { select: { name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.helpTicket.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const countOf = (f: Filter) => {
    const by = (s: TicketStatusKey) => counts.find((c) => c.status === s)?._count._all ?? 0;
    if (f === "ALL") return counts.reduce((n, c) => n + c._count._all, 0);
    if (f === "ACTIVE") return by("OPEN") + by("IN_PROGRESS");
    return by(f);
  };

  return (
    <>
      <PageHeader title="Tiketat" description="Kërkesat për ndihmë nga të gjithë dyqanet." />
      <nav aria-label="Filtro sipas statusit" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f} asChild size="sm" variant={f === filter ? "default" : "outline"}>
            <Link href={f === "ACTIVE" ? "/admin/help" : `/admin/help?status=${f}`} aria-current={f === filter ? "page" : undefined}>
              {FILTER_LABELS[f]}
              <span className="tabular-nums opacity-70">{countOf(f)}</span>
            </Link>
          </Button>
        ))}
      </nav>
      {tickets.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>Asnjë tiketë</EmptyTitle>
            <EmptyDescription>Nuk ka tiketa me këtë status.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <TicketsTable
          hrefBase="/admin/help"
          showShop
          rows={tickets.map((t) => ({
            id: t.id, subject: t.subject, status: t.status, priority: t.priority, updatedAt: t.updatedAt,
            messages: t._count.messages, createdBy: t.createdBy.name, shopName: t.organization.name,
          }))}
        />
      )}
    </>
  );
}
