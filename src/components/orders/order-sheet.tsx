"use client";
import { createContext, use, useOptimistic, useTransition } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TableRow } from "@/components/ui/table";
import { useUrlParams } from "./use-url-params";

type Ctx = { selectedId: string | null; select: (id: string | null) => void };
const OrderSheetContext = createContext<Ctx>({ selectedId: null, select: () => {} });

/**
 * The order detail lives in the URL (`?order=<id>`, deep-linkable from notifications) and is rendered on the server.
 * The sheet opens optimistically and shows a skeleton until the server detail for that id arrives.
 */
export function OrderSheetProvider({
  orderId,
  detail,
  children,
}: {
  orderId: string | null;
  detail: React.ReactNode;
  children: React.ReactNode;
}) {
  const { setParams } = useUrlParams();
  const [, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useOptimistic(orderId);

  function select(id: string | null) {
    startTransition(() => {
      setSelectedId(id);
      setParams({ order: id }, { keepPage: true });
    });
  }

  const loading = selectedId !== null && selectedId !== orderId;

  return (
    <OrderSheetContext value={{ selectedId, select }}>
      {children}
      <Sheet open={selectedId !== null} onOpenChange={(open) => !open && select(null)}>
        <SheetContent showCloseButton={false} className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg">
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3 z-10" aria-label="Mbyll">
              <XIcon />
            </Button>
          </SheetClose>
          {loading || !detail ? <OrderDetailSkeleton /> : detail}
        </SheetContent>
      </Sheet>
    </OrderSheetContext>
  );
}

function OrderDetailSkeleton() {
  return (
    <>
      <SheetHeader className="border-b p-4">
        <SheetTitle>
          <Skeleton className="h-6 w-40" />
        </SheetTitle>
        <SheetDescription className="sr-only">Duke ngarkuar porosinë</SheetDescription>
        <Skeleton className="h-4 w-28" />
      </SheetHeader>
      <div className="space-y-4 p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </>
  );
}

/** Clickable table row that opens the order sheet. The order number inside is the keyboard-accessible button. */
export function OrderRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { selectedId, select } = use(OrderSheetContext);
  return (
    <TableRow
      onClick={() => select(id)}
      data-state={selectedId === id ? "selected" : undefined}
      className="cursor-pointer"
    >
      {children}
    </TableRow>
  );
}

export function OrderOpenButton({ id, children }: { id: string; children: React.ReactNode }) {
  const { select } = use(OrderSheetContext);
  return (
    <button
      type="button"
      className="font-medium tabular-nums underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
      onClick={(e) => {
        e.stopPropagation();
        select(id);
      }}
    >
      {children}
    </button>
  );
}
