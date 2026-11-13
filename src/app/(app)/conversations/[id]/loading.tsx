import { Skeleton } from "@/components/ui/skeleton";

export default function ConversationLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Duke ngarkuar bisedën">
      <div className="flex items-center gap-3 border-b p-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <Skeleton className="h-12 w-2/3 rounded-2xl" />
        <Skeleton className="h-16 w-1/2 self-end rounded-2xl" />
        <Skeleton className="h-10 w-1/2 rounded-2xl" />
        <Skeleton className="h-20 w-3/5 self-end rounded-2xl" />
      </div>
      <div className="border-t p-3">
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
