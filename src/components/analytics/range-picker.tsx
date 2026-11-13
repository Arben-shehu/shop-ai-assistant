import Link from "next/link";
import { cn } from "@/lib/utils";

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export function parseRange(v: string | string[] | undefined): Range {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : 30;
}

/** Date-range presets as links (?range=7|30|90), so the choice is shareable and server-rendered. */
export function RangePicker({ value }: { value: Range }) {
  return (
    <nav aria-label="Periudha" className="bg-muted inline-flex rounded-lg p-0.5">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={`/analytics?range=${r}`}
          aria-current={r === value ? "page" : undefined}
          scroll={false}
          className={cn(
            "rounded-md px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            r === value ? "bg-background text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r} ditë
        </Link>
      ))}
    </nav>
  );
}
