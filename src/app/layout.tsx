import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin", "latin-ext"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Shop AI Assistant",
  description: "Asistent AI për dyqanet në WhatsApp dhe Instagram",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="sq" suppressHydrationWarning className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
