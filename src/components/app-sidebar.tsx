"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import { adminNav, shopNav, type NavItem } from "@/lib/nav";
import { UserMenu } from "@/components/user-menu";
import { ShopSwitcher } from "@/components/shop-switcher";

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
        <ShopSwitcher orgName={orgName} platformAdmin={platformAdmin} />
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
