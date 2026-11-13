"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { Info, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import type { OrderStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { updateCustomer } from "@/app/(app)/conversations/actions";

export type PanelCustomer = { id: string; name: string | null; phone: string | null; address: string | null };
export type PanelOrder = { id: string; number: number; status: OrderStatus; total: string; createdAt: string };

const ORDER_STATUS: Record<OrderStatus, string> = {
  PENDING: "Në pritje",
  CONFIRMED: "Konfirmuar",
  PREPARING: "Në përgatitje",
  DELIVERED: "Dorëzuar",
  CANCELLED: "Anuluar",
};

function CustomerForm({ customer }: { customer: PanelCustomer }) {
  const id = useId();
  const [pending, start] = useTransition();
  const [values, setValues] = useState({ name: customer.name ?? "", phone: customer.phone ?? "", address: customer.address ?? "" });
  const dirty =
    values.name !== (customer.name ?? "") || values.phone !== (customer.phone ?? "") || values.address !== (customer.address ?? "");
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateCustomer({ customerId: customer.id, ...values });
          if (res.ok) toast.success("Të dhënat e klientit u ruajtën.");
          else toast.error(res.error);
        });
      }}
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Emri</FieldLabel>
          <Input id={`${id}-name`} value={values.name} onChange={set("name")} maxLength={120} autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-phone`}>Telefoni</FieldLabel>
          <Input id={`${id}-phone`} type="tel" value={values.phone} onChange={set("phone")} maxLength={40} autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-address`}>Adresa</FieldLabel>
          <Textarea id={`${id}-address`} value={values.address} onChange={set("address")} maxLength={500} rows={2} className="min-h-14" />
        </Field>
        <Button type="submit" size="sm" disabled={!dirty || pending} className="self-start">
          {pending ? "Duke ruajtur…" : "Ruaj"}
        </Button>
      </FieldGroup>
    </form>
  );
}

function OrdersList({ orders }: { orders: PanelOrder[] }) {
  if (orders.length === 0) return <p className="text-muted-foreground text-sm">Asnjë porosi ende.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {orders.map((o) => (
        <li key={o.id}>
          <Link
            href={`/orders?order=${o.id}`}
            className="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-[3px]"
          >
            <span className="font-medium tabular-nums">#{o.number}</span>
            <Badge variant="outline">{ORDER_STATUS[o.status]}</Badge>
            <span className="ml-auto tabular-nums">{o.total}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Customer details + their orders. Remount (key) when the customer data changes to reset the form. */
export function CustomerPanel({ customer, orders }: { customer: PanelCustomer; orders: PanelOrder[] }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby={`${id}-details`} className="flex flex-col gap-3">
        <h2 id={`${id}-details`} className="text-sm font-semibold">
          Të dhënat e klientit
        </h2>
        <CustomerForm key={`${customer.name}|${customer.phone}|${customer.address}`} customer={customer} />
      </section>
      <Separator />
      <section aria-labelledby={`${id}-orders`} className="flex flex-col gap-2">
        <h2 id={`${id}-orders`} className="flex items-center gap-1.5 text-sm font-semibold">
          <ShoppingBag className="size-4" aria-hidden />
          Porositë
        </h2>
        <OrdersList orders={orders} />
      </section>
    </div>
  );
}

/** Below xl the side panel opens as a sheet. */
export function CustomerSheet(props: { customer: PanelCustomer; orders: PanelOrder[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="xl:hidden" aria-label="Të dhënat e klientit">
          <Info aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Klienti</SheetTitle>
          <SheetDescription>Të dhënat dhe porositë e klientit.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <CustomerPanel {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
