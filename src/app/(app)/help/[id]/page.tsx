import { notFound } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ReplyForm } from "@/components/help/reply-form";
import { CloseTicketButton } from "@/components/help/ticket-controls";
import { TicketHeader, loadTicket } from "@/components/help/ticket-detail";
import { TicketThread } from "@/components/help/ticket-thread";
import { requireOrg } from "@/lib/session";
import { replyToTicket } from "../actions";

export default async function HelpTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await requireOrg();
  const { id } = await params;
  const ticket = await loadTicket(id, orgId);
  if (!ticket) notFound();
  const closed = ticket.status === "CLOSED";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <TicketHeader ticket={ticket} backHref="/help" subtitle={`Hapur nga ${ticket.createdBy.name}`} />
      <TicketThread messages={ticket.thread} />
      {closed ? (
        <Alert>
          <AlertDescription>Kjo tiketë është e mbyllur. Hapni një tiketë të re nëse keni nevojë për ndihmë.</AlertDescription>
        </Alert>
      ) : (
        <>
          <ReplyForm ticketId={ticket.id} action={replyToTicket} />
          <div className="flex justify-end border-t pt-4">
            <CloseTicketButton ticketId={ticket.id} />
          </div>
        </>
      )}
    </div>
  );
}
