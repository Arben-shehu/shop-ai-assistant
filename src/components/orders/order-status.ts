import { OrderStatus } from "@/generated/prisma/enums";

// Plain module (no "use server"/"use client"): shared by the page, the actions and the client UI.

export const ORDER_STATUSES = Object.values(OrderStatus);

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Në pritje",
  CONFIRMED: "Konfirmuar",
  PREPARING: "Në përgatitje",
  DELIVERED: "Dorëzuar",
  CANCELLED: "Anuluar",
};

export const STATUS_CLASS: Record<OrderStatus, string> = {
  PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  CONFIRMED: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  PREPARING: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  DELIVERED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  CANCELLED: "bg-destructive/10 text-destructive dark:bg-destructive/20",
};

/** Forward step from each status, with the button label. */
export const NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  PENDING: { to: "CONFIRMED", label: "Konfirmo porosinë" },
  CONFIRMED: { to: "PREPARING", label: "Fillo përgatitjen" },
  PREPARING: { to: "DELIVERED", label: "Shëno si dorëzuar" },
};

/** Every status except CANCELLED can be cancelled; stock is restored only when it was not delivered yet. */
export function canTransition(from: OrderStatus, to: OrderStatus) {
  if (to === "CANCELLED") return from !== "CANCELLED";
  return NEXT_STEP[from]?.to === to;
}

export const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP_OPENWA: "WhatsApp",
  WHATSAPP_META: "WhatsApp",
  INSTAGRAM: "Instagram",
  WEB: "Web chat",
};

export const ORDERS_PAGE_SIZE = 20;

export const PERIODS = { all: "Të gjitha datat", today: "Sot", "7d": "7 ditët e fundit", "30d": "30 ditët e fundit" } as const;
export type Period = keyof typeof PERIODS;
