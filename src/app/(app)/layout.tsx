import { prisma } from "@/lib/prisma";
import { isPlatformAdmin, requireUser } from "@/lib/session";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireUser();
  const orgId = session.session.activeOrganizationId;
  const platformAdmin = isPlatformAdmin(session.user);
  const [org, member] = orgId
    ? await Promise.all([
        prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
        prisma.member.findFirst({ where: { organizationId: orgId, userId: session.user.id }, select: { role: true } }),
      ])
    : [null, null];
  const canManage = platformAdmin || (member?.role ?? "member") !== "member";

  return (
    <SidebarProvider>
      <AppSidebar orgName={org?.name ?? null} canManage={canManage} platformAdmin={platformAdmin} user={session.user} />
      <SidebarInset>
        <header className="bg-background/95 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <div className="flex-1" />
          <NotificationsBell />
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
