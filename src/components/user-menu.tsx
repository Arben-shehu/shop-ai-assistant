"use client";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ChevronsUpDown, LogOut, Moon, Sun } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ user }: { user: { name: string; email: string; image?: string | null } }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const initials = user.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <Avatar className="size-8 rounded-lg">
                {user.image && <AvatarImage src={user.image} alt={user.name} />}
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              {resolvedTheme === "dark" ? <Sun /> : <Moon />} Ndrysho temën
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                await authClient.signOut();
                router.push("/login");
              }}
            >
              <LogOut /> Dil
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
