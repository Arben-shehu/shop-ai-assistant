import { format } from "date-fns";
import { sq } from "date-fns/locale";
import { Headset } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  body: string;
  createdAt: Date;
  author: { name: string; staff: boolean };
};

/** Server component: chronological message thread. Support staff messages are highlighted. */
export function TicketThread({ messages }: { messages: ThreadMessage[] }) {
  return (
    <ol className="flex flex-col gap-3" aria-label="Mesazhet e tiketës">
      {messages.map((m) => (
        <li
          key={m.id}
          className={cn("rounded-xl border p-4", m.author.staff ? "bg-primary/5 border-primary/20" : "bg-card")}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{m.author.name}</span>
            {m.author.staff && (
              <Badge variant="secondary">
                <Headset /> Mbështetja
              </Badge>
            )}
            <time className="text-muted-foreground ml-auto text-xs" dateTime={m.createdAt.toISOString()}>
              {format(m.createdAt, "d MMM yyyy, HH:mm", { locale: sq })}
            </time>
          </div>
          <p className="text-sm break-words whitespace-pre-wrap">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
