export type BarListItem = { key: string; label: string; value: number; display: string; sub?: string };

/**
 * Meter list: one row per item with name, figure and a thin bar on a shared scale (largest = full width,
 * or `max` when the rows are parts of a known whole). One hue; the text carries every value, so the bars
 * are decorative for assistive tech.
 */
export function BarList({ items, max, label }: { items: BarListItem[]; max?: number; label: string }) {
  const scale = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-3" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate" title={i.label}>
              {i.label}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-medium">{i.display}</span>
              {i.sub && <span className="text-muted-foreground ml-1.5 text-xs">{i.sub}</span>}
            </span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
            <div
              className="bg-chart-3 dark:bg-chart-2 h-full rounded-full"
              style={{ width: `${i.value > 0 ? Math.max(1.5, (i.value / scale) * 100) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
