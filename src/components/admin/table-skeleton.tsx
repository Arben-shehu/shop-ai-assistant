import { Skeleton } from "@/components/ui/skeleton";

/** Shared loading state for list pages: header row + table rows. */
export function TableSkeleton({ rows = 6, actions = true }: { rows?: number; actions?: boolean }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Duke u ngarkuar">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        {actions && <Skeleton className="h-8 w-32" />}
      </div>
      <div className="rounded-xl border">
        <Skeleton className="h-10 rounded-b-none" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-t px-4 py-3">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="hidden h-4 w-1/6 sm:block" />
            <Skeleton className="ml-auto h-6 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
