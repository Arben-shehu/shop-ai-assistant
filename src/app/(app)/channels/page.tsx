import { format } from "date-fns";
import { sq } from "date-fns/locale";
import { Radio, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { prisma } from "@/lib/prisma";
import { requireOrg } from "@/lib/session";
import { channelTypeLabel } from "@/lib/channels";
import { openwaConfigured } from "@/lib/channels/openwa";
import { webAllowedOrigins } from "@/lib/channels/web";
import { ensureChannelWorkers } from "@/lib/channels/workers";
import { AddChannelMenu, ChannelCard, ChannelsLive, CopyField, type ChannelRow } from "./channel-ui";

export default async function ChannelsPage() {
  const { orgId } = await requireOrg({ minRole: "admin" });
  ensureChannelWorkers();
  const channels = await prisma.channel.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, type: true, name: true, externalId: true, status: true, isActive: true, createdAt: true, credentials: true, phone: true,
      _count: { select: { conversations: true } },
    },
  });

  const appUrl = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
  // Same pick as the widget API (findWidgetChannel): first active CONNECTED WhatsApp channel with a number, OpenWA first.
  const isWa = (t: string) => t === "WHATSAPP_OPENWA" || t === "WHATSAPP_META";
  const defaultWhatsApp =
    [...channels]
      .filter((c) => isWa(c.type) && c.isActive && c.status === "CONNECTED" && c.phone)
      .sort((a, b) => (a.type === "WHATSAPP_OPENWA" ? 0 : 1) - (b.type === "WHATSAPP_OPENWA" ? 0 : 1))[0]?.phone ?? null;
  const rows: ChannelRow[] = channels.map((c) => ({
    id: c.id,
    type: c.type,
    typeLabel: channelTypeLabel[c.type],
    name: c.name,
    externalId: c.externalId,
    status: c.status,
    isActive: c.isActive,
    conversations: c._count.conversations,
    phone: isWa(c.type) ? c.phone : null,
    createdAt: format(c.createdAt, "d MMM yyyy", { locale: sq }),
    // Only the (public) origins and embed code reach the browser, never the decrypted credentials object.
    web:
      c.type === "WEB"
        ? {
            origins: webAllowedOrigins(c),
            snippet: `<script src="${appUrl}/widget.js" data-key="${c.externalId}" async></script>`,
            demoUrl: `${appUrl}/widget-demo.html?key=${encodeURIComponent(c.externalId)}`,
            publicHttps: appUrl.startsWith("https://"),
            whatsappOverride: c.phone,
            whatsapp: c.phone ?? defaultWhatsApp,
          }
        : undefined,
  }));

  const verifyToken = process.env.META_VERIFY_TOKEN ?? "";
  const hasOpenwa = channels.some((c) => c.type === "WHATSAPP_OPENWA");

  return (
    <>
      <ChannelsLive />
      <PageHeader
        title="Kanalet"
        description="Numrat e WhatsApp, llogaritë e Instagram dhe chat-i në faqen tuaj web, ku asistenti u përgjigjet klientëve."
        actions={<AddChannelMenu openwaReady={openwaConfigured()} />}
      />

      {hasOpenwa && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>WhatsApp përmes OpenWA është jozyrtar</AlertTitle>
          <AlertDescription>
            Lidhet si “WhatsApp Web”. WhatsApp mund ta bllokojë numrin, sidomos kur dërgon shumë mesazhe te njerëz që s’të
            kanë shkruar. Përdorni një numër të dedikuar për dyqanin, jo numrin personal.
          </AlertDescription>
        </Alert>
      )}

      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Radio />
            </EmptyMedia>
            <EmptyTitle>Asnjë kanal i lidhur</EmptyTitle>
            <EmptyDescription>
              Lidhni një numër WhatsApp, një llogari Instagram ose shtoni chat-in në faqen tuaj web që asistenti të fillojë të përgjigjet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((r) => (
            <ChannelCard key={r.id} channel={r} />
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Webhook për Meta (WhatsApp zyrtar / Instagram)</CardTitle>
          <CardDescription>
            Në Meta for Developers → App → Webhooks, vendosni këto vlera dhe abonohuni te fusha “messages”.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <CopyField label="Callback URL" value={`${appUrl}/api/webhooks/meta`} />
          <CopyField label="Verify token" value={verifyToken || "(META_VERIFY_TOKEN nuk është vendosur në server)"} secret={!!verifyToken} />
        </CardContent>
      </Card>
    </>
  );
}
