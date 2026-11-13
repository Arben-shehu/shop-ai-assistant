"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLiveEvents } from "@/hooks/use-live-events";
import type { LiveEvent } from "@/lib/events";

/** Re-renders the current page's server components when one of `types` arrives (bursts are coalesced). */
export function LiveRefresh({ types }: { types: LiveEvent["type"][] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLiveEvents({
    filter: (e) => types.includes(e.type),
    onEvent: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 500);
    },
  });
  return null;
}
