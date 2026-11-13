import { format, isToday } from "date-fns";
import { sq } from "date-fns/locale";
import { AlertCircle, Bot, Check, Clock } from "lucide-react";
import type { ThreadMessage } from "@/app/(app)/conversations/_lib/queries";
import { cn } from "@/lib/utils";

function StatusIcon({ status }: { status: ThreadMessage["status"] }) {
  switch (status) {
    case "QUEUED":
    case "SENDING":
      return <Clock className="size-3" aria-label="Në pritje për dërgim" />;
    case "SENT":
      return <Check className="size-3" aria-label="U dërgua" />;
    case "FAILED":
      return <AlertCircle className="text-destructive size-3" aria-label="Dështoi" />;
    default:
      return null;
  }
}

/** One chat bubble: customer on the left, AI / operator on the right. */
export function MessageBubble({ message, customerName }: { message: ThreadMessage; customerName: string }) {
  const inbound = message.sender === "CUSTOMER";
  const failed = message.status === "FAILED";
  const author =
    message.sender === "AI" ? "Asistenti AI" : message.sender === "OPERATOR" ? (message.operator?.name ?? "Operator") : customerName;
  const time = format(message.createdAt, isToday(message.createdAt) ? "HH:mm" : "d MMM, HH:mm", { locale: sq });
  const isImage = message.mediaUrl && (!message.mediaType || message.mediaType.startsWith("image/"));

  return (
    <li className={cn("flex flex-col gap-1", inbound ? "items-start" : "items-end")}>
      <span className="text-muted-foreground flex items-center gap-1 px-1 text-xs">
        {message.sender === "AI" && <Bot className="size-3.5" aria-hidden />}
        {inbound && <span className="sr-only">Klienti</span>}
        {author}
      </span>
      <div
        className={cn(
          "max-w-[85%] overflow-hidden rounded-2xl text-sm sm:max-w-[75%]",
          inbound && "bg-muted rounded-bl-sm",
          message.sender === "AI" && "rounded-br-sm bg-sky-500/10 dark:bg-sky-400/15",
          message.sender === "OPERATOR" && "bg-primary text-primary-foreground rounded-br-sm",
          failed && "ring-destructive/60 ring-1",
        )}
      >
        {message.mediaUrl &&
          (isImage ? (
            <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote channel media, host not known in advance */}
              <img src={message.mediaUrl} alt="Foto e dërguar në bisedë" className="max-h-72 w-full object-cover" />
            </a>
          ) : (
            <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="block px-3 pt-2 underline underline-offset-2">
              Hap skedarin
            </a>
          ))}
        {message.text && <p className="px-3 py-2 break-words whitespace-pre-wrap">{message.text}</p>}
      </div>
      <span className="text-muted-foreground flex items-center gap-1 px-1 text-[11px]">
        <time dateTime={message.createdAt.toISOString()}>{time}</time>
        {!inbound && <StatusIcon status={message.status} />}
      </span>
      {failed && (
        <p className="text-destructive flex max-w-[85%] items-start gap-1 px-1 text-xs sm:max-w-[75%]" role="note">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>Nuk u dërgua{message.error ? `: ${message.error}` : "."}</span>
        </p>
      )}
    </li>
  );
}
