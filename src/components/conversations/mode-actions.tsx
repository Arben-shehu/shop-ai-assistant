"use client";

import { useTransition } from "react";
import { Bot, Lock, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import type { ConversationMode } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { closeConversation, returnToAi, takeOverConversation, type ActionResult } from "@/app/(app)/conversations/actions";

function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, success: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) toast.success(success);
      else toast.error(res.error);
    });
  return [pending, run] as const;
}

export function TakeOverButton({ conversationId, className }: { conversationId: string; className?: string }) {
  const [pending, run] = useAction();
  return (
    <Button
      size="sm"
      className={className}
      disabled={pending}
      onClick={() => run(() => takeOverConversation(conversationId), "E morët bisedën. AI nuk do të përgjigjet më.")}
    >
      {pending ? <Spinner data-icon="inline-start" aria-label="Duke ruajtur" /> : <UserRoundCheck data-icon="inline-start" aria-hidden />}
      Merr bisedën
    </Button>
  );
}

/** Header controls: take over (AI → operator), hand back to AI, close. */
export function ModeActions({
  conversationId,
  mode,
  assignedToMe,
}: {
  conversationId: string;
  mode: ConversationMode;
  assignedToMe: boolean;
}) {
  const [pending, run] = useAction();
  return (
    <div className="flex items-center gap-1.5">
      {(mode !== "HUMAN" || !assignedToMe) && <TakeOverButton conversationId={conversationId} />}
      {mode !== "AI" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label="Ktheje te AI"
          onClick={() => run(() => returnToAi(conversationId), "Biseda iu kthye asistentit AI.")}
        >
          <Bot data-icon="inline-start" aria-hidden />
          <span className="hidden sm:inline">Ktheje te AI</span>
        </Button>
      )}
      {mode !== "CLOSED" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label="Mbyll bisedën"
          onClick={() => run(() => closeConversation(conversationId), "Biseda u mbyll.")}
        >
          <Lock data-icon="inline-start" aria-hidden />
          <span className="hidden sm:inline">Mbyll</span>
        </Button>
      )}
    </div>
  );
}
