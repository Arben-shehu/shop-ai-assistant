"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { useLiveEvents } from "@/hooks/use-live-events";
import { cn } from "@/lib/utils";

/**
 * Two-pane inbox. Desktop: list + thread side by side. Phone: the list and the open thread are separate screens.
 * Owns the single live-events subscription for the whole inbox.
 */
export function InboxShell({ header, list, children }: { header: React.ReactNode; list: React.ReactNode; children: React.ReactNode }) {
  const threadOpen = useSelectedLayoutSegment() !== null;
  useLiveEvents({ filter: (e) => e.type === "message" || e.type === "conversation" });

  return (
    <div className="flex h-[calc(100svh-3.5rem-2rem)] min-h-[28rem] flex-col gap-4 md:h-[calc(100svh-3.5rem-3rem)]">
      <div className={cn(threadOpen && "hidden md:block")}>{header}</div>
      <div className="flex min-h-0 flex-1 gap-4">
        <section
          aria-label="Lista e bisedave"
          className={cn(
            "bg-card min-h-0 w-full flex-col overflow-hidden rounded-xl border md:flex md:w-80 md:shrink-0 lg:w-96",
            threadOpen ? "hidden" : "flex",
          )}
        >
          {list}
        </section>
        <section
          aria-label="Biseda"
          className={cn("bg-card min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border", threadOpen ? "flex" : "hidden md:flex")}
        >
          {children}
        </section>
      </div>
    </div>
  );
}
