import Link from "next/link";
import { AlertTriangleIcon, BanknoteIcon, PackageIcon, PackageXIcon } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StockSummaryData = { total: number; active: number; out: number; low: number; valueLabel: string; units: number };

/** Four KPI cards; the stock ones link to the matching table filter. */
export function StockSummary({ data }: { data: StockSummaryData }) {
  const cards = [
    { label: "Produkte gjithsej", value: String(data.total), hint: `${data.active} aktive`, icon: PackageIcon, href: "/stock" },
    {
      label: "Pa stok",
      value: String(data.out),
      hint: "Produkte aktive me stok 0",
      icon: PackageXIcon,
      href: "/stock?filter=out",
      tone: data.out > 0 ? "text-destructive" : undefined,
    },
    {
      label: "Stok i ulët",
      value: String(data.low),
      hint: "3 ose më pak copë",
      icon: AlertTriangleIcon,
      href: "/stock?filter=low",
      tone: data.low > 0 ? "text-amber-600 dark:text-amber-400" : undefined,
    },
    { label: "Vlera e inventarit", value: data.valueLabel, hint: `${data.units} copë në magazinë`, icon: BanknoteIcon },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => {
        const body = (
          <Card className={cn("h-full gap-1 py-4", c.href && "hover:bg-muted/40 transition-colors")}>
            <CardHeader className="px-4">
              <CardDescription className="flex items-center justify-between gap-2">
                {c.label}
                <c.icon className={cn("size-4", c.tone)} aria-hidden />
              </CardDescription>
              <CardTitle className={cn("truncate text-xl font-semibold tabular-nums sm:text-2xl", c.tone)}>{c.value}</CardTitle>
              <p className="text-muted-foreground truncate text-xs">{c.hint}</p>
            </CardHeader>
          </Card>
        );
        return c.href ? (
          <Link key={c.label} href={c.href} className="focus-visible:ring-ring/50 rounded-xl focus-visible:ring-3 focus-visible:outline-none">
            {body}
          </Link>
        ) : (
          <div key={c.label}>{body}</div>
        );
      })}
    </div>
  );
}

export const SAMPLE_SUMMARY: StockSummaryData = { total: 89, active: 89, out: 0, low: 0, valueLabel: "123 456,78 €", units: 1000 };
