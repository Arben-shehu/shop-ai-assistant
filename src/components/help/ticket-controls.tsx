"use client";
import { useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { adminUpdateTicket } from "@/app/(app)/admin/help/actions";
import { closeTicket } from "@/app/(app)/help/actions";
import { PRIORITY_LABELS, STATUS_LABELS, type TicketPriorityKey, type TicketStatusKey } from "./ticket-badges";

/** Platform admin: change status / priority. */
export function AdminTicketControls({ ticketId, status, priority }: { ticketId: string; status: TicketStatusKey; priority: TicketPriorityKey }) {
  const [pending, startTransition] = useTransition();
  const update = (patch: { status?: TicketStatusKey; priority?: TicketPriorityKey }) =>
    startTransition(async () => {
      const res = await adminUpdateTicket({ ticketId, ...patch });
      if (res.ok) toast.success("Tiketa u përditësua.");
      else toast.error(res.error);
    });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="ticket-status">Statusi</FieldLabel>
        <Select value={status} onValueChange={(v) => update({ status: v as TicketStatusKey })} disabled={pending}>
          <SelectTrigger id="ticket-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABELS) as TicketStatusKey[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="ticket-priority">Prioriteti</FieldLabel>
        <Select value={priority} onValueChange={(v) => update({ priority: v as TicketPriorityKey })} disabled={pending}>
          <SelectTrigger id="ticket-priority" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PRIORITY_LABELS) as TicketPriorityKey[]).map((p) => (
              <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/** Shop side: mark the ticket as closed once the problem is solved. */
export function CloseTicketButton({ ticketId }: { ticketId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await closeTicket({ ticketId });
          if (res.ok) toast.success("Tiketa u mbyll.");
          else toast.error(res.error);
        })
      }
    >
      {pending ? <Spinner /> : <CheckCircle2 />} Mbyll tiketën
    </Button>
  );
}
