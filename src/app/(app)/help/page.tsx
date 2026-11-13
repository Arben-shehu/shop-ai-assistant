import { LifeBuoy } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { NewTicketDialog } from "@/components/help/new-ticket-dialog";
import { TicketsTable } from "@/components/help/tickets-table";
import { prisma } from "@/lib/prisma";
import { requireOrg } from "@/lib/session";

export default async function HelpPage() {
  const { orgId } = await requireOrg();
  const tickets = await prisma.helpTicket.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, subject: true, status: true, priority: true, updatedAt: true,
      createdBy: { select: { name: true } },
      _count: { select: { messages: true } },
    },
  });

  return (
    <>
      <PageHeader title="Ndihma" description="Tiketat e dyqanit tuaj drejt ekipit të mbështetjes." actions={tickets.length > 0 && <NewTicketDialog />} />
      {tickets.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LifeBuoy />
            </EmptyMedia>
            <EmptyTitle>Asnjë tiketë ende</EmptyTitle>
            <EmptyDescription>Keni një problem me kanalet, asistentin AI apo diçka tjetër? Na shkruani.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewTicketDialog />
          </EmptyContent>
        </Empty>
      ) : (
        <TicketsTable
          hrefBase="/help"
          rows={tickets.map((t) => ({
            id: t.id, subject: t.subject, status: t.status, priority: t.priority, updatedAt: t.updatedAt,
            messages: t._count.messages, createdBy: t.createdBy.name,
          }))}
        />
      )}
    </>
  );
}
