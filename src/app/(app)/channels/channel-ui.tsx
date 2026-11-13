"use client";
import { useEffect, useState, useTransition } from "react";
import {
  Camera, Check, ChevronDown, Copy, ExternalLink, Eye, EyeOff, Globe, KeyRound, MessageCircle, MoreHorizontal, Plug, PlugZap,
  Plus, QrCode, RefreshCw, Smartphone, Trash2, TriangleAlert, Unplug,
} from "lucide-react";
import { toast } from "sonner";
import type { ChannelStatus, ChannelType } from "@/generated/prisma/client";
import { useLiveEvents } from "@/hooks/use-live-events";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createMetaChannel, createOpenwaChannel, createWebChannel, deleteChannel, disconnectChannel, pollOpenwaChannel,
  reconnectOpenwaChannel, setChannelActive, testChannel, updateChannelToken, updateWebOrigins,
} from "./actions";

export type ChannelRow = {
  id: string;
  type: ChannelType;
  typeLabel: string;
  name: string;
  externalId: string;
  status: ChannelStatus;
  isActive: boolean;
  conversations: number;
  createdAt: string;
  /** WEB only: allowed origins + embed code (no secrets). */
  web?: { origins: string[]; snippet: string; demoUrl: string; publicHttps: boolean };
};

const statusLabel: Record<ChannelStatus, string> = {
  PENDING: "Në pritje",
  CONNECTED: "I lidhur",
  DISCONNECTED: "I shkëputur",
  ERROR: "Gabim",
};

function StatusBadge({ status, active }: { status: ChannelStatus; active: boolean }) {
  if (!active) return <Badge variant="outline">Çaktivizuar</Badge>;
  const variant = status === "CONNECTED" ? "default" : status === "ERROR" ? "destructive" : status === "PENDING" ? "secondary" : "outline";
  return <Badge variant={variant}>{statusLabel[status]}</Badge>;
}

function TypeIcon({ type }: { type: ChannelType }) {
  if (type === "INSTAGRAM") return <Camera className="size-4" />;
  if (type === "WEB") return <Globe className="size-4" />;
  if (type === "WHATSAPP_META") return <MessageCircle className="size-4" />;
  return <Smartphone className="size-4" />;
}

/** Re-render the page when a channel changes (status from the monitor, QR scanned, another admin's edit). */
export function ChannelsLive() {
  useLiveEvents({ filter: (e) => e.type === "channel" });
  return null;
}

export function CopyField({
  label, value, secret = false, multiline = false,
}: { label: string; value: string; secret?: boolean; multiline?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Kopjimi dështoi");
    }
  }
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        {multiline ? (
          <Textarea readOnly value={value} rows={3} className="min-h-0 resize-none font-mono text-xs break-all" />
        ) : (
          <Input readOnly value={shown ? value : "•".repeat(Math.min(value.length, 24))} className="font-mono text-xs" />
        )}
        {secret && (
          <Button type="button" variant="outline" size="icon" onClick={() => setShown((s) => !s)} aria-label={shown ? "Fshih" : "Shfaq"}>
            {shown ? <EyeOff /> : <Eye />}
          </Button>
        )}
        <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Kopjo">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- add channel

export function AddChannelMenu({ openwaReady }: { openwaReady: boolean }) {
  const [dialog, setDialog] = useState<null | "openwa" | "WHATSAPP_META" | "INSTAGRAM" | "WEB">(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus /> Shto kanal <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!openwaReady} onSelect={() => setDialog("openwa")}>
            <Smartphone /> Lidh WhatsApp (OpenWA)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("WHATSAPP_META")}>
            <MessageCircle /> Shto WhatsApp zyrtar (Meta)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("INSTAGRAM")}>
            <Camera /> Shto Instagram
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("WEB")}>
            <Globe /> Shto Web chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddOpenwaDialog
        open={dialog === "openwa"}
        onOpenChange={(o) => !o && setDialog(null)}
        onCreated={(id) => {
          setDialog(null);
          setQrFor(id);
        }}
      />
      {(dialog === "WHATSAPP_META" || dialog === "INSTAGRAM") && (
        <AddMetaDialog type={dialog} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
      {qrFor && <QrDialog channelId={qrFor} open onOpenChange={(o) => !o && setQrFor(null)} />}
      {dialog === "WEB" && <WebChannelDialog open onOpenChange={(o) => !o && setDialog(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- web chat

const ORIGINS_HELP = "Një adresë për rresht, p.sh. https://dyqani.al dhe https://www.dyqani.al. Vetëm këto faqe mund ta shfaqin chat-in.";

/** Create a web chat channel (no `channel`) or edit the allowed origins of an existing one. */
function WebChannelDialog({
  channel, open, onOpenChange,
}: { channel?: { id: string; origins: string[] }; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editing = !!channel;
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const origins = String(f.get("origins") ?? "");
    setError(null);
    start(async () => {
      const r = editing
        ? await updateWebOrigins({ id: channel.id, origins })
        : await createWebChannel({ name: String(f.get("name") ?? ""), origins });
      if (!r.ok) return setError(r.error);
      toast.success(editing ? "Faqet e lejuara u ruajtën" : "Web chat u krijua. Kopjoni kodin në faqen tuaj.");
      onOpenChange(false);
    });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Faqet e lejuara" : "Shto Web chat"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Chat-i funksionon vetëm në faqet e listuara këtu."
                : "Një flluskë chat-i në faqen tuaj web. Vizitorët i shkruajnë asistentit dhe bisedat shfaqen te Bisedat."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {!editing && (
              <Field>
                <FieldLabel htmlFor="web-name">Emri i kanalit</FieldLabel>
                <Input id="web-name" name="name" required minLength={2} maxLength={60} placeholder="p.sh. Chat në faqe" />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="web-origins">Adresat e faqes</FieldLabel>
              <Textarea
                id="web-origins"
                name="origins"
                rows={3}
                className="font-mono text-xs"
                placeholder="https://dyqani.al"
                defaultValue={channel?.origins.join("\n")}
              />
              <FieldDescription>{ORIGINS_HELP}</FieldDescription>
            </Field>
          </FieldGroup>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} {editing ? "Ruaj" : "Krijo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WebEmbed({ web }: { web: NonNullable<ChannelRow["web"]> }) {
  return (
    <div className="mt-2 grid gap-3">
      <CopyField label="Kodi për faqen (vendoseni para </body>)" value={web.snippet} multiline />
      <div className="text-muted-foreground grid gap-1">
        <span>Faqet e lejuara:</span>
        {web.origins.length ? (
          <ul className="text-foreground grid gap-0.5 font-mono text-xs">
            {web.origins.map((o) => (
              <li key={o} className="truncate">
                {o}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs">Asnjë ende — chat-i funksionon vetëm në faqen e provës.</span>
        )}
      </div>
      {!web.publicHttps && (
        <p className="flex gap-2 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Serveri nuk ka ende adresë publike HTTPS. Chat-i funksionon në faqe reale vetëm pasi serveri të ketë një URL publike
          HTTPS; deri atëherë provojeni te faqja e provës.
        </p>
      )}
      <Button variant="outline" size="sm" className="w-fit" asChild>
        <a href={web.demoUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink /> Hap faqen e provës
        </a>
      </Button>
    </div>
  );
}

function AddOpenwaDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    setError(null);
    start(async () => {
      const r = await createOpenwaChannel({ name });
      if (!r.ok) return setError(r.error);
      toast.success("Kanali u krijua. Skanoni kodin QR.");
      onCreated(r.channelId);
    });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Lidh WhatsApp (OpenWA)</DialogTitle>
            <DialogDescription>
              Jozyrtar: numri mund të bllokohet nga WhatsApp. Përdorni një numër të dedikuar për dyqanin.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="openwa-name">Emri i kanalit</FieldLabel>
              <Input id="openwa-name" name="name" placeholder="p.sh. WhatsApp i dyqanit" required minLength={2} maxLength={60} />
            </Field>
          </FieldGroup>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} Vazhdo te kodi QR
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddMetaDialog({
  type, open, onOpenChange,
}: { type: "WHATSAPP_META" | "INSTAGRAM"; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wa = type === "WHATSAPP_META";
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const r = await createMetaChannel({
        type,
        name: String(f.get("name") ?? ""),
        externalId: String(f.get("externalId") ?? ""),
        accessToken: String(f.get("accessToken") ?? ""),
      });
      if (!r.ok) return setError(r.error);
      if (r.info.startsWith("U ruajt")) toast.warning(r.info);
      else toast.success(`Kanali u lidh: ${r.info}`);
      onOpenChange(false);
    });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{wa ? "Shto WhatsApp zyrtar (Meta)" : "Shto Instagram"}</DialogTitle>
            <DialogDescription>
              {wa
                ? "WhatsApp Cloud API nga Meta for Developers. Token-i ruhet i enkriptuar dhe nuk shfaqet më."
                : "Llogari profesionale Instagram (Instagram API me Instagram Login). Token-i ruhet i enkriptuar."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="meta-name">Emri i kanalit</FieldLabel>
              <Input id="meta-name" name="name" required minLength={2} maxLength={60} placeholder={wa ? "WhatsApp zyrtar" : "Instagram i dyqanit"} />
            </Field>
            <Field>
              <FieldLabel htmlFor="meta-external">{wa ? "Phone number ID" : "Instagram account ID"}</FieldLabel>
              <Input id="meta-external" name="externalId" required inputMode="numeric" pattern="\d{5,30}" className="font-mono" />
              <FieldDescription>
                {wa ? "Te WhatsApp → API Setup (jo vetë numri i telefonit)." : "ID numerike e llogarisë (IG user id)."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="meta-token">Access token</FieldLabel>
              <Input id="meta-token" name="accessToken" type="password" required autoComplete="off" className="font-mono" />
              <FieldDescription>Përdorni një token të përhershëm (System User), jo atë 24-orësh.</FieldDescription>
            </Field>
          </FieldGroup>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} Ruaj dhe testo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- QR

function QrDialog({ channelId, open, onOpenChange }: { channelId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [gateway, setGateway] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const r = await pollOpenwaChannel(channelId).catch(() => null);
      if (!alive) return;
      if (!r) setError("Lidhja me serverin dështoi");
      else if (!r.ok) setError(r.error);
      else {
        setError(null);
        setGateway(r.gateway);
        if (r.status === "CONNECTED") {
          toast.success("WhatsApp u lidh!");
          onOpenChange(false);
          return;
        }
        setQr(r.qr);
      }
      timer = setTimeout(poll, 3000); // the QR rotates every ~30 s
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [channelId, open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Skanoni kodin QR</DialogTitle>
          <DialogDescription>
            Në telefon: WhatsApp → Cilësimet → Pajisjet e lidhura → Lidh një pajisje. Kodi rifreskohet vetë.
          </DialogDescription>
        </DialogHeader>
        <div className="flex aspect-square w-full max-w-72 items-center justify-center self-center justify-self-center rounded-lg border bg-white p-3">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL from the gateway
            <img src={qr} alt="Kodi QR i WhatsApp" className="size-full" />
          ) : (
            <div className="text-muted-foreground flex flex-col items-center gap-2 text-sm">
              <Spinner />
              {gateway === "authenticating" ? "Po lidhet…" : "Po përgatitet kodi…"}
            </div>
          )}
        </div>
        {error && <p className="text-destructive text-center text-sm">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- channel card

export function ChannelCard({ channel: c }: { channel: ChannelRow }) {
  const [pending, start] = useTransition();
  const [qrOpen, setQrOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "disconnect">(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [originsOpen, setOriginsOpen] = useState(false);
  const openwa = c.type === "WHATSAPP_OPENWA";

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.error);
    });

  function test() {
    start(async () => {
      const r = await testChannel(c.id);
      if (r.ok) toast.success(`Lidhja funksionon: ${r.info}`);
      else toast.error(`Testi dështoi: ${r.error}`);
    });
  }

  function reconnect() {
    start(async () => {
      const r = await reconnectOpenwaChannel(c.id);
      if (!r.ok) return void toast.error(r.error);
      setQrOpen(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <TypeIcon type={c.type} />
          <span className="truncate">{c.name}</span>
        </CardTitle>
        <CardDescription>{c.typeLabel}</CardDescription>
        <CardAction className="flex items-center gap-2">
          <StatusBadge status={c.status} active={c.isActive} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Veprime" disabled={pending}>
                {pending ? <Spinner /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={test}>
                <PlugZap /> Testo lidhjen
              </DropdownMenuItem>
              {openwa ? (
                <>
                  <DropdownMenuItem onSelect={() => (c.status === "CONNECTED" ? reconnect() : setQrOpen(true))}>
                    {c.status === "CONNECTED" ? <RefreshCw /> : <QrCode />}
                    {c.status === "CONNECTED" ? "Rilidh" : "Shfaq kodin QR"}
                  </DropdownMenuItem>
                  {c.status !== "CONNECTED" && (
                    <DropdownMenuItem onSelect={reconnect}>
                      <RefreshCw /> Rilidh (rinis sesionin)
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setConfirm("disconnect")}>
                    <Unplug /> Shkëput
                  </DropdownMenuItem>
                </>
              ) : c.type === "WEB" ? (
                <DropdownMenuItem onSelect={() => setOriginsOpen(true)}>
                  <Globe /> Ndrysho faqet e lejuara
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setTokenOpen(true)}>
                  <KeyRound /> Ndrysho token-in
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                <Trash2 /> Fshi kanalin
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <div className="text-muted-foreground flex min-w-0 gap-2">
          <span className="shrink-0">
            {openwa ? "Sesioni:" : c.type === "INSTAGRAM" ? "Account ID:" : c.type === "WEB" ? "Çelësi i widget-it:" : "Phone number ID:"}
          </span>
          <span className="text-foreground truncate font-mono text-xs leading-5">{c.externalId}</span>
        </div>
        <div className="text-muted-foreground">
          {c.conversations} biseda · shtuar më {c.createdAt}
        </div>
        {openwa && c.status === "PENDING" && c.isActive && (
          <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => setQrOpen(true)}>
            <QrCode /> Skano kodin QR
          </Button>
        )}
        {c.web && <WebEmbed web={c.web} />}
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <Label htmlFor={`active-${c.id}`} className="text-muted-foreground font-normal">
          {c.isActive ? "Aktiv — asistenti përgjigjet" : "Çaktivizuar"}
        </Label>
        <Switch
          id={`active-${c.id}`}
          checked={c.isActive}
          disabled={pending}
          onCheckedChange={(v) => run(() => setChannelActive({ id: c.id, active: v }), v ? "Kanali u aktivizua" : "Kanali u çaktivizua")}
        />
      </CardFooter>

      {qrOpen && <QrDialog channelId={c.id} open onOpenChange={setQrOpen} />}
      {tokenOpen && <TokenDialog id={c.id} open onOpenChange={setTokenOpen} />}
      {originsOpen && c.web && (
        <WebChannelDialog channel={{ id: c.id, origins: c.web.origins }} open onOpenChange={setOriginsOpen} />
      )}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? `Të fshihet “${c.name}”?` : `Të shkëputet “${c.name}”?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? `Fshihen edhe ${c.conversations} bisedat dhe mesazhet e këtij kanali. Porositë mbeten. Ky veprim nuk kthehet.`
                : "Sesioni ndalet dhe kanali çaktivizohet. Lidhja me telefonin ruhet: “Rilidh” e kthen pa skanuar sërish."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anulo</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "delete" ? "destructive" : "default"}
              onClick={() =>
                confirm === "delete"
                  ? run(() => deleteChannel(c.id), "Kanali u fshi")
                  : run(() => disconnectChannel(c.id), "Kanali u shkëput")
              }
            >
              {confirm === "delete" ? <Trash2 /> : <Plug />}
              {confirm === "delete" ? "Fshi" : "Shkëput"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function TokenDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const accessToken = String(new FormData(e.currentTarget).get("accessToken") ?? "");
    setError(null);
    start(async () => {
      const r = await updateChannelToken({ id, accessToken });
      if (!r.ok) return setError(r.error);
      toast.success("Token-i u përditësua");
      onOpenChange(false);
    });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Ndrysho token-in</DialogTitle>
            <DialogDescription>Token-i i ri zëvendëson të vjetrin. Ruhet i enkriptuar dhe nuk shfaqet më.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`token-${id}`}>Access token</FieldLabel>
            <Input id={`token-${id}`} name="accessToken" type="password" required autoComplete="off" className="font-mono" />
          </Field>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} Ruaj
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
