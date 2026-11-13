"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { LiveEvent } from "@/lib/events";

/**
 * Subscribe to the shop's live events. Default handler re-renders server components (router.refresh()).
 * Pass `filter` to refresh only on relevant events, or `onEvent` for custom handling.
 */
export function useLiveEvents(opts: { filter?: (e: LiveEvent) => boolean; onEvent?: (e: LiveEvent) => void } = {}) {
  const router = useRouter();
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as LiveEvent;
      if (ref.current.filter && !ref.current.filter(e)) return;
      if (ref.current.onEvent) ref.current.onEvent(e);
      else router.refresh();
    };
    return () => es.close();
  }, [router]);
}
