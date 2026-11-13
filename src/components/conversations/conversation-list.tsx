import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { sq } from "date-fns/locale";
import { ImageIcon, MessagesSquare, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import type { ConversationListItem, InboxFilters } from "@/app/(app)/conversations/_lib/queries";
import { ChannelIcon } from "./channel-icon";
import { CustomerAvatar, customerLabel } from "./customer-avatar";
import { ListFilters } from "./list-filters";
import { ModeBadge } from "./mode-badge";

const SENDER_PREFIX = { CUSTOMER: "", AI: "AI: ", OPERATOR: "Operatori: " } as const;

function Preview({ message }: { message: ConversationListItem["messages"][number] | undefined }) {
  if (!message) return <span className="italic">Pa mesazhe</span>;
  return (
    <>
      {SENDER_PREFIX[message.sender]}
      {message.mediaUrl && <ImageIcon className="mr-1 inline size-3.5 align-[-2px]" aria-label="Foto" />}
      {message.text || (message.mediaUrl ? "Foto" : "")}
    </>
  );
}

export function ConversationList({
  items,
  filters,
  activeId,
  query,
}: {
  items: ConversationListItem[];
  filters: InboxFilters;
  activeId?: string;
  /** "?q=..&mode=.." to keep the filters when opening a thread. */
  query: string;
}) {
  const filtered = filters.q !== "" || filters.mode !== "all";
  return (
    <>
      <ListFilters q={filters.q} mode={filters.mode} />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">{filtered ? <SearchX /> : <MessagesSquare />}</EmptyMedia>
            <EmptyTitle>{filtered ? "Asnjë rezultat" : "Ende pa biseda"}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Asnjë bisedë nuk përputhet me kërkimin ose filtrin."
                : "Bisedat me klientët nga WhatsApp dhe Instagram do të shfaqen këtu."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-label="Bisedat">
          {items.map((c) => {
            const active = c.id === activeId;
            const unread = active ? 0 : c.unreadCount;
            return (
              <li key={c.id}>
                <Link
                  href={`/conversations/${c.id}${query}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "hover:bg-muted focus-visible:ring-ring/50 flex items-start gap-3 rounded-lg p-2.5 outline-none focus-visible:ring-[3px]",
                    active && "bg-muted",
                  )}
                >
                  <CustomerAvatar name={c.customer.name} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <ChannelIcon type={c.channel.type} />
                      <span className={cn("truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>
                        {customerLabel(c.customer)}
                      </span>
                      <time
                        dateTime={c.lastMessageAt.toISOString()}
                        title={c.lastMessageAt.toLocaleString("sq-AL")}
                        className="text-muted-foreground ml-auto shrink-0 text-xs"
                      >
                        {formatDistanceToNowStrict(c.lastMessageAt, { locale: sq })}
                      </time>
                    </div>
                    <p className={cn("line-clamp-1 text-sm", unread > 0 ? "text-foreground" : "text-muted-foreground")}>
                      <Preview message={c.messages[0]} />
                    </p>
                    <div className="flex items-center gap-1.5">
                      <ModeBadge mode={c.mode} />
                      {unread > 0 && (
                        <Badge className="ml-auto tabular-nums" aria-label={`${unread} mesazhe të palexuara`}>
                          {unread}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
