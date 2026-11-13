import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";

export default async function AdminIndexPage() {
  await requireAdmin();
  redirect("/admin/businesses");
}
