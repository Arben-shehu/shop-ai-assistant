import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

/** KPI tile: label, headline value, one muted line of context. Whole tile is a link when `href` is set. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  href?: string;
}) {
  const body = (
    <Card className="h-full gap-2 px-4 py-4 transition-colors group-hover/tile:bg-muted/40">
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
        <span>{label}</span>
        <Icon className="size-4 shrink-0" aria-hidden />
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="group/tile rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      {body}
    </Link>
  ) : (
    body
  );
}
