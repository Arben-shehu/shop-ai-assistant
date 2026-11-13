"use client";
import type { LiveEvent } from "@/lib/events";
import { useLiveEvents } from "@/hooks/use-live-events";

/** Re-render the page's server components when one of these live events arrives. */
export function LiveRefresh({ types }: { types: LiveEvent["type"][] }) {
  useLiveEvents({ filter: (e) => types.includes(e.type) });
  return null;
}
