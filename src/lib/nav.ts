import {
  LayoutDashboard, MessagesSquare, ShoppingCart, Package, BarChart3, Users, LifeBuoy, Settings,
  Radio, Building2, UserCog, Inbox, ScrollText, type LucideIcon,
} from "lucide-react";

export type NavItem = { title: string; href: string; icon: LucideIcon; minRole?: "admin" };

// Shop navigation (labels are Albanian: the app's UI language).
export const shopNav: NavItem[] = [
  { title: "Paneli", href: "/", icon: LayoutDashboard },
  { title: "Bisedat", href: "/conversations", icon: MessagesSquare },
  { title: "Porositë", href: "/orders", icon: ShoppingCart },
  { title: "Magazina", href: "/stock", icon: Package },
  { title: "Analitika", href: "/analytics", icon: BarChart3 },
  { title: "Kanalet", href: "/channels", icon: Radio, minRole: "admin" },
  { title: "Operatorët", href: "/operators", icon: Users, minRole: "admin" },
  { title: "Aktiviteti", href: "/activity", icon: ScrollText, minRole: "admin" },
  { title: "Ndihma", href: "/help", icon: LifeBuoy },
  { title: "Cilësimet", href: "/settings", icon: Settings, minRole: "admin" },
];

// Platform super-admin navigation.
export const adminNav: NavItem[] = [
  { title: "Bizneset", href: "/admin/businesses", icon: Building2 },
  { title: "Përdoruesit", href: "/admin/users", icon: UserCog },
  { title: "Tiketat", href: "/admin/help", icon: Inbox },
];
