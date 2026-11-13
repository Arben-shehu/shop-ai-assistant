import { format, formatDistanceToNow } from "date-fns";
import { sq } from "date-fns/locale";

// Isomorphic formatting helpers (safe in server and client components).
// Prefer calling them in server components and passing strings down: server/browser timezone and ICU can differ.

/** Prisma.Decimal, number or numeric string. */
export type MoneyLike = number | string | { toString(): string };

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** "1.499,99 €" (sq-AL). Falls back to "1499.99 XYZ" for an unknown currency code. */
export function formatMoney(value: MoneyLike | null | undefined, currency = "EUR"): string {
  const n = typeof value === "number" ? value : Number(value?.toString() ?? 0);
  let f = moneyFormatters.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat("sq-AL", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return `${n.toFixed(2)} ${currency}`;
    }
    moneyFormatters.set(currency, f);
  }
  return f.format(Number.isFinite(n) ? n : 0);
}

/** "13 nën 2026" — or with time: "13 nën 2026, 14:05". */
export function formatDate(date: Date | string | number, opts: { time?: boolean } = {}): string {
  return format(new Date(date), opts.time ? "d MMM yyyy, HH:mm" : "d MMM yyyy", { locale: sq });
}

/** "para 5 minutash". */
export function formatRelative(date: Date | string | number): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: sq });
}
