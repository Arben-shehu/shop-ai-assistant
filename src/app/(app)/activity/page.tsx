import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { requireOrg } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard/bits";
import { formatDateTime } from "@/components/dashboard/lib";
import { actionLabel, entityLabel, metaSummary, normalizeEntity } from "./labels";

export const metadata: Metadata = { title: "Aktiviteti" };

const PAGE_SIZE = 25;

/** Where the affected object lives: its detail page when one exists, otherwise its list page. */
function target(entity: string | null, id: string | null, orderNumbers: Map<string, number>): { label: string; href: string | null } | null {
  switch (entity) {
    case "order": {
      const n = id ? orderNumbers.get(id) : undefined;
      return { label: n ? `Porosia #${n}` : "Porosi", href: id && n ? `/orders?order=${id}` : "/orders" };
    }
    case "conversation":
      return { label: "Biseda", href: id ? `/conversations/${id}` : "/conversations" };
    case "ticket":
      return { label: "Tiketa", href: id ? `/help/${id}` : "/help" };
    case "product":
      return { label: "Magazina", href: "/stock" };
    case "channel":
      return { label: "Kanalet", href: "/channels" };
    case "operator":
    case "member":
    case "invitation":
      return { label: "Operatorët", href: "/operators" };
    case "settings":
      return { label: "Cilësimet", href: "/settings" };
    case null:
      return null;
    default:
      return { label: entityLabel(entity), href: null };
  }
}

function query(params: { type?: string; page?: number }) {
  const sp = new URLSearchParams();
  if (params.type) sp.set("type", params.type);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const s = sp.toString();
  return s ? `/activity?${s}` : "/activity";
}

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const { orgId } = await requireOrg({ minRole: "admin" });
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  // Filter chips come from the prefixes this shop actually has; anything else in ?type= is ignored.
  const actions = await prisma.activityLog.groupBy({ by: ["action"], where: { organizationId: orgId } });
  const prefixes = [...new Set(actions.map((a) => a.action.split(".")[0]))].sort((a, b) => entityLabel(a).localeCompare(entityLabel(b), "sq"));
  const requested = one(sp.type);
  const type = requested && prefixes.includes(requested) ? requested : undefined;

  const where = { organizationId: orgId, ...(type ? { action: { startsWith: `${type}.` } } : {}) };
  const total = await prisma.activityLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(one(sp.page)) || 1)));
  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      meta: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  // The entity is decided by the action prefix ("operator.*" rows carry entityType "user"), falling back to entityType.
  const entityOf = (r: (typeof rows)[number]) => normalizeEntity(r.action.split(".")[0]) ?? normalizeEntity(r.entityType);
  const orderIds = rows.filter((r) => entityOf(r) === "order" && r.entityId).map((r) => r.entityId!);
  const orderNumbers = new Map(
    orderIds.length
      ? (
          await prisma.order.findMany({ where: { organizationId: orgId, id: { in: orderIds } }, select: { id: true, number: true } })
        ).map((o) => [o.id, o.number])
      : [],
  );

  return (
    <>
      <PageHeader title="Aktiviteti" description="Kush bëri çfarë në dyqan" />

      {prefixes.length > 0 && (
        <nav aria-label="Filtro sipas llojit" className="flex flex-wrap gap-2">
          {[undefined, ...prefixes].map((p) => (
            <Link
              key={p ?? "all"}
              href={query({ type: p })}
              aria-current={p === type ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                p === type ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted text-muted-foreground",
              )}
            >
              {p ? entityLabel(p) : "Të gjitha"}
            </Link>
          ))}
        </nav>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="Ende pa aktivitet" description="Veprimet e operatorëve dhe administratorëve do të regjistrohen këtu." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Koha</TableHead>
                <TableHead>Përdoruesi</TableHead>
                <TableHead>Veprimi</TableHead>
                <TableHead>Objekti</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const prefix = r.action.split(".")[0];
                const t = target(entityOf(r), r.entityId, orderNumbers);
                const detail = metaSummary(r.meta);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell>
                      {r.user ? (
                        <span title={r.user.email}>{r.user.name}</span>
                      ) : (
                        <span className="text-muted-foreground">Sistemi</span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-48 whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{entityLabel(prefix)}</Badge>
                        <span title={r.action}>{actionLabel(r.action)}</span>
                      </div>
                      {detail && <div className="text-muted-foreground mt-1 text-xs">{detail}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {t?.href ? (
                        <Link href={t.href} className="underline underline-offset-4 hover:no-underline">
                          {t.label}
                        </Link>
                      ) : t ? (
                        <span className="text-muted-foreground">{t.label}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Faqosja" className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            Faqja {page} nga {pages} · {total} regjistrime
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={query({ type, page: page - 1 })} rel="prev">
                  <ChevronLeft data-icon="inline-start" /> Më të rejat
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <ChevronLeft data-icon="inline-start" /> Më të rejat
              </Button>
            )}
            {page < pages ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={query({ type, page: page + 1 })} rel="next">
                  Më të vjetrat <ChevronRight data-icon="inline-end" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Më të vjetrat <ChevronRight data-icon="inline-end" />
              </Button>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
