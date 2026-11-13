import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Duke ngarkuar">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-8 w-full max-w-xl" />
      <Skeleton className="h-8 w-full max-w-sm" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
