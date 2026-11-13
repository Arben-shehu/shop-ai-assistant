import { Bot, Lock, UserRound } from "lucide-react";
import type { ConversationMode } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const MODE_LABEL: Record<ConversationMode, string> = { AI: "AI", HUMAN: "Operator", CLOSED: "Mbyllur" };

const STYLE: Record<ConversationMode, string> = {
  AI: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  HUMAN: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  CLOSED: "bg-muted text-muted-foreground",
};

const ICON = { AI: Bot, HUMAN: UserRound, CLOSED: Lock } as const;

export function ModeBadge({ mode, className }: { mode: ConversationMode; className?: string }) {
  const Icon = ICON[mode];
  return (
    <Badge variant="secondary" className={cn(STYLE[mode], className)}>
      <Icon data-icon="inline-start" aria-hidden />
      {MODE_LABEL[mode]}
    </Badge>
  );
}
