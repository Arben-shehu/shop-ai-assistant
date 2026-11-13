import { Skeleton } from "@/components/ui/skeleton";

export default function ConversationListLoading() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Duke ngarkuar bisedat">
      <div className="flex flex-col gap-3 border-b p-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex flex-col gap-1 p-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 p-2.5">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
