"use client";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { MinusIcon, PlusIcon } from "lucide-react";
import { adjustStock, setProductActive } from "@/app/(app)/stock/actions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/** -/+ buttons around the stock count. Clicks apply optimistically and queue as server actions. */
export function StockAdjuster({ productId, name, stock }: { productId: string; name: string; stock: number }) {
  const [, startTransition] = useTransition();
  const [shown, addDelta] = useOptimistic(stock, (s, d: number) => Math.max(0, s + d));

  function adjust(delta: number) {
    startTransition(async () => {
      addDelta(delta);
      const res = await adjustStock({ productId, delta });
      if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="inline-flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-xs"
        onClick={() => adjust(-1)}
        disabled={shown <= 0}
        aria-label={`Ul stokun e ${name}`}
      >
        <MinusIcon />
      </Button>
      <span className="min-w-8 text-center font-medium tabular-nums" aria-live="polite">
        {shown}
      </span>
      <Button variant="outline" size="icon-xs" onClick={() => adjust(1)} aria-label={`Rrit stokun e ${name}`}>
        <PlusIcon />
      </Button>
    </div>
  );
}

export function ActiveSwitch({ productId, name, isActive }: { productId: string; name: string; isActive: boolean }) {
  const [, startTransition] = useTransition();
  const [checked, setChecked] = useOptimistic(isActive);

  return (
    <Switch
      checked={checked}
      aria-label={`Aktiv: ${name}`}
      onCheckedChange={(next) =>
        startTransition(async () => {
          setChecked(next);
          const res = await setProductActive({ productId, isActive: next });
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        })
      }
    />
  );
}
