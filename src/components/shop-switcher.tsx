"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Building2, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { SHOP_ROLE_LABELS } from "@/components/admin/types";
import { listMyShops, switchShop, type ShopOption } from "@/components/settings/active-shop-actions";

/**
 * Sidebar-header shop switcher. Lists the user's shops (all shops for platform admins), loaded lazily
 * on open, and switches the session's active shop, then goes to the dashboard.
 *
 * Props:
 * - orgName: name of the active shop (null when none is active) — shown on the trigger.
 * - platformAdmin: adds a link to /admin/businesses.
 */
export function ShopSwitcher({ orgName, platformAdmin = false }: { orgName: string | null; platformAdmin?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shops, setShops] = useState<ShopOption[] | null>(null);
  const [loading, startLoading] = useTransition();
  const [switching, startSwitching] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next)
      startLoading(async () => {
        try {
          setShops(await listMyShops());
        } catch {
          toast.error("Dyqanet nuk u ngarkuan.");
        }
      });
  }

  function select(shop: ShopOption) {
    if (shop.active) return setOpen(false);
    startSwitching(async () => {
      const res = await switchShop({ orgId: shop.id });
      if (!res.ok) return void toast.error(res.error);
      setOpen(false);
      toast.success(`Tani jeni te “${shop.name}”.`);
      router.push("/");
      router.refresh();
    });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <SidebarMenuButton size="lg" aria-label="Ndrysho dyqanin" className="data-[state=open]:bg-sidebar-accent">
              <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                {switching ? <Spinner /> : <Bot className="size-4" />}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{orgName ?? "Zgjidh dyqanin"}</span>
                <span className="text-muted-foreground truncate text-xs">Asistent AI</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
            <Command>
              {(shops?.length ?? 0) > 6 && <CommandInput placeholder="Kërko dyqan…" />}
              <CommandList>
                {loading && !shops ? (
                  <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
                    <Spinner /> Duke u ngarkuar…
                  </div>
                ) : (
                  <>
                    <CommandEmpty>Asnjë dyqan.</CommandEmpty>
                    <CommandGroup heading="Dyqanet">
                      {shops?.map((s) => (
                        <CommandItem key={s.id} value={`${s.name} ${s.slug}`} onSelect={() => select(s)} disabled={switching}>
                          <div className="grid flex-1 leading-tight">
                            <span className="truncate">{s.name}</span>
                            <span className="text-muted-foreground truncate text-xs">
                              {s.role ? SHOP_ROLE_LABELS[s.role] ?? s.role : "Admin i platformës"}
                            </span>
                          </div>
                          {s.active && <Check className="size-4" aria-label="Aktiv" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
                {platformAdmin && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem value="__admin_businesses" onSelect={() => { setOpen(false); router.push("/admin/businesses"); }}>
                        <Building2 /> Menaxho bizneset
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
