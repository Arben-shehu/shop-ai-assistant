"use client";

import { useEffect, useRef } from "react";
import { markConversationRead } from "@/app/(app)/conversations/actions";

/**
 * Scrollable message list: keeps the newest message in view and marks the conversation read
 * whenever it is open with unread messages (also when new ones arrive live).
 */
export function MessageLog({
  conversationId,
  lastMessageId,
  unreadCount,
  children,
}: {
  conversationId: string;
  lastMessageId: string | null;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const seen = useRef<string | null>(null);
  const atBottom = useRef(true);

  // New message: jump to it (smoothly after the first render).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = seen.current === null;
    seen.current = lastMessageId;
    atBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: first ? "instant" : "smooth" });
  }, [lastMessageId]);

  // Late layout (styles, fonts, images, panel resize): stay pinned to the newest message if the reader was there.
  useEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (unreadCount > 0) void markConversationRead(conversationId);
  }, [conversationId, unreadCount]);

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <ol role="log" aria-live="polite" aria-label="Mesazhet" className="flex flex-col gap-3">
        {children}
      </ol>
    </div>
  );
}
