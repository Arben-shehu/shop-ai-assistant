"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import { adminNav, shopNav, type NavItem } from "@/lib/nav";
import { UserMenu } from "@/components/user-menu";

type Props = {
  orgName: string | null;
  canManage: boolean; // shop owner/admin or platform admin
  platformAdmin: boolean;
  user: { name: string; email: string; image?: string | null };
};

export function AppSidebar({ orgName, canManage, platformAdmin, user }: Props) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
          <Link href={item.href}>
            <item.icon />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Bot className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{orgName ?? "Shop AI"}</span>
                  <span className="text-muted-foreground truncate text-xs">Asistent AI</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {orgName && (
          <SidebarGroup>
            <SidebarGroupLabel>Dyqani</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(shopNav.filter((i) => !i.minRole || canManage))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {platformAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Platforma</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(adminNav)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
