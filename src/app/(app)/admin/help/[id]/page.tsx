import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ReplyForm } from "@/components/help/reply-form";
import { AdminTicketControls } from "@/components/help/ticket-controls";
import { TicketHeader, loadTicket } from "@/components/help/ticket-detail";
import { TicketThread } from "@/components/help/ticket-thread";
import { requireAdmin } from "@/lib/session";
import { adminReplyToTicket } from "../actions";

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const ticket = await loadTicket(id);
  if (!ticket) notFound();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <TicketHeader
        ticket={ticket}
        backHref="/admin/help"
        subtitle={`${ticket.organization.name} · ${ticket.createdBy.name} (${ticket.createdBy.email})`}
      />
      <Card>
        <CardContent>
          <AdminTicketControls key={`${ticket.status}-${ticket.priority}`} ticketId={ticket.id} status={ticket.status} priority={ticket.priority} />
        </CardContent>
      </Card>
      <TicketThread messages={ticket.thread} />
      <ReplyForm ticketId={ticket.id} action={adminReplyToTicket} />
    </div>
  );
}
