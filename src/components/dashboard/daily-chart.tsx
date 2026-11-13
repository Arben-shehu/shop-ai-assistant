"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

/** Built by dailyChartData() on the server; all display strings are pre-formatted there. */
export type DailyChartData = {
  points: { day: string; label: string; orders: number; revenue: number; ordersText: string; revenueText: string }[];
  totals: { orders: string; revenue: string };
  empty: boolean;
};
type Metric = "orders" | "revenue";

// Single series at a time (no dual axis). The theme's chart tokens are neutral grays:
// a darker step on the light card, a mid step on the dark card (both >= 3:1 against the surface).
const config = {
  orders: { label: "Porosi", theme: { light: "var(--chart-3)", dark: "var(--chart-2)" } },
  revenue: { label: "Të ardhura", theme: { light: "var(--chart-3)", dark: "var(--chart-2)" } },
} satisfies ChartConfig;

const compact = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : `${n}`;

/** Daily orders / revenue bars with a metric switch. Totals in the switch double as the stat values. */
export function DailyChart({ data, height = 240 }: { data: DailyChartData; height?: number }) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const text = (m: Metric) => (m === "revenue" ? "revenueText" : "ordersText");

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Zgjidh metrikën" className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
        {(["revenue", "orders"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={metric === m}
            onClick={() => setMetric(m)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              metric === m ? "bg-muted border-foreground/20" : "hover:bg-muted/50",
            )}
          >
            <span className="text-muted-foreground text-xs">{config[m].label}</span>
            <span className="text-lg font-semibold">{data.totals[m]}</span>
          </button>
        ))}
      </div>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart data={data.points} margin={{ left: 0, right: 4, top: 8 }} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={metric === "revenue"} tickFormatter={(v: number) => compact(v)} />
          <ChartTooltip
            cursor={{ fillOpacity: 0.5 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, p) => p?.[0]?.payload?.label}
                formatter={(_value, _name, item) => (
                  <div className="flex w-full items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-[2px] bg-(--color-orders)" />
                    <span className="text-muted-foreground">{config[metric].label}</span>
                    <span className="ml-auto font-medium tabular-nums">{item.payload?.[text(metric)]}</span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>Porositë dhe të ardhurat sipas ditës</caption>
        <thead>
          <tr>
            <th scope="col">Dita</th>
            <th scope="col">Porosi</th>
            <th scope="col">Të ardhura</th>
          </tr>
        </thead>
        <tbody>
          {data.points.map((d) => (
            <tr key={d.day}>
              <td>{d.label}</td>
              <td>{d.ordersText}</td>
              <td>{d.revenueText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
