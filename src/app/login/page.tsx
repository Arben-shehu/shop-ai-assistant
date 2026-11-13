import { redirect } from "next/navigation";
import { Bot } from "lucide-react";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2 font-semibold">
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
          <Bot className="size-4" />
        </div>
        Shop AI Assistant
      </div>
      <LoginForm />
    </div>
  );
}
