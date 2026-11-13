"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRightIcon, MapPinIcon, MessageSquareIcon, PhoneIcon, UserIcon, XCircleIcon } from "lucide-react";
import type { OrderStatus } from "@/generated/prisma/enums";
import { updateOrderNotes, updateOrderStatus } from "@/app/(app)/orders/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { NEXT_STEP, STATUS_LABEL } from "./order-status";
import { OrderStatusBadge } from "./order-status-badge";

/** Everything pre-formatted on the server. */
export type OrderDetailData = {
  id: string;
  number: number;
  status: OrderStatus;
  createdLabel: string;
  updatedLabel: string;
  totalLabel: string;
  deliveryAddress: string | null;
  notes: string | null;
  channelLabel: string | null;
  conversationId: string | null;
  customer: { name: string | null; phone: string | null };
  items: { id: string; name: string; quantity: number; unitPriceLabel: string; subtotalLabel: string; removed: boolean }[];
};

const FLOW: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "DELIVERED"];

export function OrderDetail({ order }: { order: OrderDetailData }) {
  const [pending, startTransition] = useTransition();
  const next = NEXT_STEP[order.status];

  function changeStatus(status: OrderStatus) {
    startTransition(async () => {
      const res = await updateOrderStatus({ orderId: order.id, status });
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b p-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="text-lg tabular-nums">Porosia #{order.number}</SheetTitle>
          <OrderStatusBadge status={order.status} />
        </div>
        <SheetDescription>Krijuar më {order.createdLabel}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {/* Status */}
        <section aria-labelledby="order-status-h" className="space-y-3">
          <h3 id="order-status-h" className="text-sm font-medium">
            Statusi
          </h3>
          <StatusSteps status={order.status} />
          {order.status !== "CANCELLED" && (
            <div className="flex flex-wrap gap-2">
              {next && (
                <Button onClick={() => changeStatus(next.to)} disabled={pending}>
                  {pending ? <Spinner data-icon="inline-start" aria-label="Duke ruajtur" /> : <ArrowRightIcon data-icon="inline-start" />}
                  {next.label}
                </Button>
              )}
              <CancelOrderButton
                delivered={order.status === "DELIVERED"}
                disabled={pending}
                onConfirm={() => changeStatus("CANCELLED")}
              />
            </div>
          )}
          <p className="text-muted-foreground text-xs">Përditësuar më {order.updatedLabel}</p>
        </section>

        <Separator />

        {/* Customer */}
        <section aria-labelledby="order-customer-h" className="space-y-2 text-sm">
          <h3 id="order-customer-h" className="font-medium">
            Klienti
          </h3>
          <dl className="space-y-1.5">
            <InfoRow icon={UserIcon} label="Emri">
              {order.customer.name ?? <span className="text-muted-foreground">Pa emër</span>}
            </InfoRow>
            {order.customer.phone && (
              <InfoRow icon={PhoneIcon} label="Telefoni">
                <a href={`tel:${order.customer.phone}`} className="underline-offset-4 hover:underline">
                  {order.customer.phone}
                </a>
              </InfoRow>
            )}
            <InfoRow icon={MapPinIcon} label="Adresa e dorëzimit">
              {order.deliveryAddress ? (
                <span className="whitespace-pre-line">{order.deliveryAddress}</span>
              ) : (
                <span className="text-muted-foreground">Pa adresë</span>
              )}
            </InfoRow>
          </dl>
          {order.conversationId && (
            <Button asChild variant="outline" size="sm" className="mt-1">
              <Link href={`/conversations/${order.conversationId}`}>
                <MessageSquareIcon data-icon="inline-start" />
                Hap bisedën{order.channelLabel ? ` (${order.channelLabel})` : ""}
              </Link>
            </Button>
          )}
        </section>

        <Separator />

        {/* Items */}
        <section aria-labelledby="order-items-h" className="space-y-2">
          <h3 id="order-items-h" className="text-sm font-medium">
            Artikujt
          </h3>
          <ul className="divide-y rounded-lg border text-sm">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium break-words">{item.name}</p>
                  <p className="text-muted-foreground tabular-nums">
                    {item.quantity} × {item.unitPriceLabel}
                    {item.removed && " · produkti është fshirë"}
                  </p>
                </div>
                <p className="shrink-0 font-medium tabular-nums">{item.subtotalLabel}</p>
              </li>
            ))}
            <li className="bg-muted/40 flex items-center justify-between gap-3 p-3 font-semibold">
              <span>Totali</span>
              <span className="tabular-nums">{order.totalLabel}</span>
            </li>
          </ul>
        </section>

        <Separator />

        <NotesForm key={`${order.id}:${order.notes ?? ""}`} orderId={order.id} initial={order.notes ?? ""} />
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function StatusSteps({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED") {
    return (
      <p className="text-destructive flex items-center gap-2 text-sm">
        <XCircleIcon className="size-4" aria-hidden /> Kjo porosi është anuluar.
      </p>
    );
  }
  const current = FLOW.indexOf(status);
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Ecuria e porosisë">
      {FLOW.map((s, i) => (
        <li key={s} className="space-y-1.5" aria-current={i === current ? "step" : undefined}>
          <div className={cn("h-1.5 rounded-full", i <= current ? "bg-primary" : "bg-muted")} />
          <p className={cn("text-xs", i <= current ? "text-foreground font-medium" : "text-muted-foreground")}>
            {STATUS_LABEL[s]}
          </p>
        </li>
      ))}
    </ol>
  );
}

function CancelOrderButton({ delivered, disabled, onConfirm }: { delivered: boolean; disabled: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={disabled} className="text-destructive hover:text-destructive">
          <XCircleIcon data-icon="inline-start" />
          Anulo
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Të anulohet porosia?</AlertDialogTitle>
          <AlertDialogDescription>
            {delivered
              ? "Porosia është dorëzuar tashmë, prandaj stoku NUK do të rikthehet automatikisht."
              : "Sasitë e artikujve do të rikthehen në stok. Ky veprim nuk mund të zhbëhet."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Kthehu</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Anulo porosinë
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function NotesForm({ orderId, initial }: { orderId: string; initial: string }) {
  const [notes, setNotes] = useState(initial);
  const [pending, startTransition] = useTransition();
  const dirty = notes.trim() !== initial.trim();

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await updateOrderNotes({ orderId, notes });
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        });
      }}
    >
      <Field>
        <FieldLabel htmlFor="order-notes">Shënime të brendshme</FieldLabel>
        <Textarea
          id="order-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="P.sh. klienti preferon dorëzim pas orës 17:00"
        />
        <FieldDescription>Shihen vetëm nga stafi i dyqanit.</FieldDescription>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!dirty || pending}>
          {pending && <Spinner data-icon="inline-start" aria-label="Duke ruajtur" />}
          Ruaj shënimet
        </Button>
      </div>
    </form>
  );
}
