import "server-only";
import Link from "next/link";
import { format } from "date-fns";
import { sq } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { prisma } from "@/lib/prisma";
import { TicketPriorityBadge, TicketStatusBadge } from "./ticket-badges";

/** Loads a ticket with its thread. Pass orgId to scope to a shop (shop side); omit only for platform admins. */
export async function loadTicket(id: string, orgId?: string) {
  const ticket = await prisma.helpTicket.findFirst({
    where: { id, ...(orgId ? { organizationId: orgId } : {}) },
    select: {
      id: true, subject: true, status: true, priority: true, createdAt: true, organizationId: true,
      organization: { select: { name: true, slug: true } },
      createdBy: { select: { name: true, email: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true, author: { select: { name: true, role: true } } },
      },
    },
  });
  if (!ticket) return null;
  return {
    ...ticket,
    thread: ticket.messages.map((m) => ({
      id: m.id, body: m.body, createdAt: m.createdAt,
      author: { name: m.author.name, staff: m.author.role === "admin" },
    })),
  };
}

export function TicketHeader({
  ticket, backHref, subtitle,
}: {
  ticket: NonNullable<Awaited<ReturnType<typeof loadTicket>>>;
  backHref: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href={backHref}>
          <ArrowLeft /> Kthehu te tiketat
        </Link>
      </Button>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight break-words">{ticket.subject}</h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
          <span>{subtitle}</span>
          <span aria-hidden>·</span>
          <span>{format(ticket.createdAt, "d MMM yyyy", { locale: sq })}</span>
        </div>
      </div>
    </div>
  );
}

export function TicketDetailSkeleton() {
  return (
    <div className="flex max-w-3xl flex-col gap-4" aria-busy="true" aria-label="Duke u ngarkuar">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-5 w-64" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}
