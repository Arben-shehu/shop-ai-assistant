"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { createTicket } from "@/app/(app)/help/actions";
import { PRIORITY_LABELS, type TicketPriorityKey } from "./ticket-badges";

export function NewTicketDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<TicketPriorityKey>("MEDIUM");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createTicket({ subject: String(f.get("subject")), body: String(f.get("body")), priority });
      if (!res.ok) return setError(res.error);
      toast.success("Tiketa u dërgua. Do t’ju njoftojmë kur të përgjigjemi.");
      setOpen(false);
      if (res.data) router.push(`/help/${res.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setPriority("MEDIUM"); } }}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Tiketë e re
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kërkoni ndihmë</DialogTitle>
          <DialogDescription>Përshkruani problemin dhe ekipi i mbështetjes do t’ju përgjigjet këtu.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="t-subject">Subjekti</FieldLabel>
              <Input id="t-subject" name="subject" required minLength={3} maxLength={150} placeholder="p.sh. WhatsApp nuk po lidhet" />
            </Field>
            <Field>
              <FieldLabel htmlFor="t-priority">Prioriteti</FieldLabel>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriorityKey)}>
                <SelectTrigger id="t-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as TicketPriorityKey[]).map((p) => (
                    <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="t-body">Mesazhi</FieldLabel>
              <Textarea id="t-body" name="body" required minLength={2} maxLength={5000} rows={5} placeholder="Çfarë ndodhi? Çfarë prisnit të ndodhte?" />
            </Field>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} Dërgo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
