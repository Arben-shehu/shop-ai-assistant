import { Skeleton } from "@/components/ui/skeleton";

// Generic fallback for every page in the app shell that has no loading.tsx of its own: keep it page-agnostic.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Duke u ngarkuar">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
