import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function CustomerAvatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <Avatar className={cn("size-10", className)} aria-hidden>
      <AvatarFallback className="text-xs font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** Display name for a customer: name, else phone, else external id ("Vizitor web" for web chat visitors). */
export function customerLabel(c: { name: string | null; phone: string | null; externalId: string }) {
  if (c.name?.trim()) return c.name.trim();
  if (c.phone) return c.phone;
  // Web widget visitors: externalId is "web:<sha256 hex>"; a short suffix tells visitors apart.
  if (c.externalId.startsWith("web:")) return `Vizitor web #${c.externalId.slice(4, 8)}`;
  return `+${c.externalId}`;
}
