"use client";

import { useId, useRef, useState, useTransition } from "react";
import { SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { ConversationMode } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { sendOperatorMessage } from "@/app/(app)/conversations/actions";
import { TakeOverButton } from "./mode-actions";

/** Operator reply box. Enter sends, Shift+Enter adds a new line. Only active in HUMAN mode. */
export function Composer({ conversationId, mode }: { conversationId: string; mode: ConversationMode }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const enabled = mode === "HUMAN";

  function send() {
    const value = text.trim();
    if (!value || pending || !enabled) return;
    start(async () => {
      const res = await sendOperatorMessage({ conversationId, text: value });
      if (res.ok) {
        setText("");
        ref.current?.focus();
      } else toast.error(res.error);
    });
  }

  return (
    <form
      className="border-t p-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {!enabled && (
        <div id={hintId} className="bg-muted/60 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {mode === "CLOSED" ? "Biseda është e mbyllur." : "AI po i përgjigjet klientit."} Merrni bisedën për t&apos;i shkruar.
          </span>
          <TakeOverButton conversationId={conversationId} />
        </div>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor={`${hintId}-text`} className="sr-only">
          Mesazhi për klientin
        </label>
        <Textarea
          ref={ref}
          id={`${hintId}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          disabled={!enabled}
          aria-describedby={enabled ? undefined : hintId}
          placeholder={enabled ? "Shkruani një mesazh… (Enter dërgon, Shift+Enter rresht i ri)" : "Merrni bisedën për të shkruar"}
          rows={1}
          maxLength={4000}
          className="max-h-40 min-h-10 resize-none"
        />
        <Button type="submit" size="icon-lg" disabled={!enabled || pending || !text.trim()} aria-label="Dërgo mesazhin">
          {pending ? <Spinner aria-label="Duke dërguar" /> : <SendHorizontal aria-hidden />}
        </Button>
      </div>
    </form>
  );
}
