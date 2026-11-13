"use client";
import { useState, useTransition } from "react";
import { Building2, LogIn, MoreHorizontal, Pencil, Radio, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteShop, enterShop, updateShop } from "@/app/(app)/admin/businesses/actions";

export type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  owners: string[];
  members: number;
  products: number;
  channels: number;
  channelsConnected: number;
  channelsError: number;
  createdAt: string;
  active: boolean;
};

export function BusinessesTable({ rows }: { rows: BusinessRow[] }) {
  const [editing, setEditing] = useState<BusinessRow | null>(null);
  const [deleting, setDeleting] = useState<BusinessRow | null>(null);
  const [pending, startTransition] = useTransition();

  function enter(row: BusinessRow, to: "/" | "/channels") {
    startTransition(async () => {
      const res = await enterShop({ id: row.id, to });
      // On success the action redirects; a returned value means it failed.
      if (res && !res.ok) toast.error(res.error);
    });
  }

  if (rows.length === 0)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Building2 />
          </EmptyMedia>
          <EmptyTitle>Ende pa dyqane</EmptyTitle>
          <EmptyDescription>Krijoni dyqanin e parë me butonin “Dyqan i ri”.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  return (
    <>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dyqani</TableHead>
              <TableHead className="hidden md:table-cell">Pronari</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Anëtarë</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Produkte</TableHead>
              <TableHead className="hidden lg:table-cell">Kanalet</TableHead>
              <TableHead className="hidden lg:table-cell">Krijuar</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Veprime</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {row.name}
                    {row.active && <Badge variant="secondary">Aktiv</Badge>}
                  </div>
                  <div className="text-muted-foreground text-xs">{row.slug}</div>
                  <div className="text-muted-foreground text-xs md:hidden">{row.owners[0] ?? "—"}</div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {row.owners.length ? (
                    <div className="flex flex-col text-sm">
                      {row.owners.map((e) => <span key={e}>{e}</span>)}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{row.members}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{row.products}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  <ChannelsBadge row={row} />
                </TableCell>
                <TableCell className="text-muted-foreground hidden lg:table-cell">{row.createdAt}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => enter(row, "/")} className="hidden sm:inline-flex">
                      <LogIn /> Hyr si ky dyqan
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label={`Veprime për ${row.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={pending} onSelect={() => enter(row, "/")}>
                          <LogIn /> Hyr si ky dyqan
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={pending} onSelect={() => enter(row, "/channels")}>
                          <Radio /> Hap kanalet
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setEditing(row)}>
                          <Pencil /> Ndrysho
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row)}>
                          <Trash2 /> Fshi
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && <EditBusinessDialog key={editing.id} row={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteBusinessDialog key={deleting.id} row={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function ChannelsBadge({ row }: { row: BusinessRow }) {
  if (row.channels === 0) return <span className="text-muted-foreground text-sm">Asnjë</span>;
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="outline">
        {row.channelsConnected}/{row.channels} të lidhur
      </Badge>
      {row.channelsError > 0 && <Badge variant="destructive">{row.channelsError} me gabim</Badge>}
    </div>
  );
}

function EditBusinessDialog({ row, onClose }: { row: BusinessRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await updateShop({ id: row.id, name: String(f.get("name")), slug: String(f.get("slug")) });
      if (!res.ok) return setError(res.error);
      toast.success("Dyqani u përditësua.");
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ndrysho dyqanin</DialogTitle>
          <DialogDescription>Ndryshoni emrin ose slug-un e dyqanit.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-name">Emri</FieldLabel>
              <Input id="edit-name" name="name" defaultValue={row.name} required minLength={2} maxLength={100} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-slug">Slug</FieldLabel>
              <Input id="edit-slug" name="slug" defaultValue={row.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            </Field>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} Ruaj
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBusinessDialog({ row, onClose }: { row: BusinessRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState("");

  function onDelete() {
    startTransition(async () => {
      const res = await deleteShop({ id: row.id, confirm });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Dyqani u fshi.");
      onClose();
    });
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Fshi “{row.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Fshihen përgjithmonë kanalet, bisedat, klientët, produktet, porositë dhe tiketat e këtij dyqani. Ky veprim
            nuk kthehet mbrapsht.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="confirm-slug">
            Shkruani <span className="font-mono font-semibold">{row.slug}</span> për të konfirmuar
          </FieldLabel>
          <Input id="confirm-slug" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Anulo</AlertDialogCancel>
          <Button variant="destructive" disabled={pending || confirm.trim() !== row.slug} onClick={onDelete}>
            {pending && <Spinner />} Fshi dyqanin
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
