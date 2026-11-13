"use client";
import { useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/components/admin/types";

/** Reply box for a ticket. `action` is a server action (shop or admin variant). */
export function ReplyForm({
  ticketId,
  action,
}: {
  ticketId: string;
  action: (input: { ticketId: string; body: string }) => Promise<ActionResult>;
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await action({ ticketId, body });
      if (!res.ok) return void toast.error(res.error);
      setBody("");
      toast.success("Përgjigja u dërgua.");
      ref.current?.focus();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="reply-body">Përgjigju</FieldLabel>
        <Textarea
          id="reply-body"
          ref={ref}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          rows={4}
          required
          minLength={2}
          maxLength={5000}
          placeholder="Shkruani mesazhin…"
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || body.trim().length < 2}>
          {pending ? <Spinner /> : <Send />} Dërgo
        </Button>
      </div>
    </form>
  );
}
