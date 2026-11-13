"use client";
import { useState, useTransition } from "react";
import { Ban, KeyRound, MoreHorizontal, ShieldCheck, Trash2, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteUser, resetPassword, setBanned, setPlatformRole } from "@/app/(app)/admin/users/actions";
import { SHOP_ROLE_LABELS } from "@/components/admin/types";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  banned: boolean;
  createdAt: string;
  shops: { id: string; name: string; role: string }[];
  self: boolean;
};

type Dialogs = { kind: "role" | "password" | "ban" | "delete"; user: UserRow } | null;

export function UsersTable({ rows }: { rows: UserRow[] }) {
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [pending, startTransition] = useTransition();
  const close = () => setDialog(null);

  function unban(user: UserRow) {
    startTransition(async () => {
      const res = await setBanned({ userId: user.id, banned: false });
      if (res.ok) toast.success("Përdoruesi u zhbllokua.");
      else toast.error(res.error);
    });
  }

  if (rows.length === 0)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Users />
          </EmptyMedia>
          <EmptyTitle>Ende pa përdorues</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );

  return (
    <>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Përdoruesi</TableHead>
              <TableHead className="hidden sm:table-cell">Roli</TableHead>
              <TableHead className="hidden md:table-cell">Dyqanet</TableHead>
              <TableHead className="hidden lg:table-cell">Krijuar</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Veprime</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {u.name}
                    {u.self && <Badge variant="secondary">Ju</Badge>}
                    {u.banned && <Badge variant="destructive">I bllokuar</Badge>}
                  </div>
                  <div className="text-muted-foreground text-xs">{u.email}</div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {u.role === "admin" ? (
                    <Badge><ShieldCheck /> Admin</Badge>
                  ) : (
                    <Badge variant="outline">Përdorues</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {u.shops.length ? (
                    <div className="flex flex-wrap gap-1">
                      {u.shops.map((s) => (
                        <Badge key={s.id} variant="outline" className="font-normal">
                          {s.name} · {SHOP_ROLE_LABELS[s.role] ?? s.role}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground hidden lg:table-cell">{u.createdAt}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label={`Veprime për ${u.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={u.self} onSelect={() => setDialog({ kind: "role", user: u })}>
                        <ShieldCheck /> Ndrysho rolin
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDialog({ kind: "password", user: u })}>
                        <KeyRound /> Rivendos fjalëkalimin
                      </DropdownMenuItem>
                      {u.banned ? (
                        <DropdownMenuItem disabled={pending} onSelect={() => unban(u)}>
                          <UserCheck /> Zhblloko
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled={u.self} onSelect={() => setDialog({ kind: "ban", user: u })}>
                          <Ban /> Blloko
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={u.self} onSelect={() => setDialog({ kind: "delete", user: u })}>
                        <Trash2 /> Fshi
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {dialog?.kind === "role" && <RoleDialog user={dialog.user} onClose={close} />}
      {dialog?.kind === "password" && <PasswordDialog user={dialog.user} onClose={close} />}
      {dialog?.kind === "ban" && <BanDialog user={dialog.user} onClose={close} />}
      {dialog?.kind === "delete" && <DeleteDialog user={dialog.user} onClose={close} />}
    </>
  );
}

function RoleDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [role, setRole] = useState(user.role);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const res = await setPlatformRole({ userId: user.id, role });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Roli u ndryshua.");
      onClose();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roli në platformë</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="role-select">Roli</FieldLabel>
          <Select value={role} onValueChange={(v) => setRole(v as UserRow["role"])}>
            <SelectTrigger id="role-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">Përdorues</SelectItem>
              <SelectItem value="admin">Administrator i platformës</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>Administratorët e platformës kanë akses në të gjitha dyqanet.</FieldDescription>
        </Field>
        <DialogFooter>
          <Button onClick={save} disabled={pending || role === user.role}>
            {pending && <Spinner />} Ruaj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setError(null);
    startTransition(async () => {
      const res = await resetPassword({ userId: user.id, password });
      if (!res.ok) return setError(res.error);
      toast.success("Fjalëkalimi u ndryshua.");
      onClose();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rivendos fjalëkalimin</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-password">Fjalëkalimi i ri</FieldLabel>
              <Input id="new-password" name="password" type="password" required minLength={8} autoComplete="new-password" />
              <FieldDescription>Të paktën 8 karaktere.</FieldDescription>
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

function BanDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const ban = () =>
    startTransition(async () => {
      const res = await setBanned({ userId: user.id, banned: true, reason });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Përdoruesi u bllokua.");
      onClose();
    });
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Blloko {user.name}?</AlertDialogTitle>
          <AlertDialogDescription>Përdoruesi del nga të gjitha sesionet dhe nuk mund të hyjë derisa të zhbllokohet.</AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="ban-reason">Arsyeja (opsionale)</FieldLabel>
          <Input id="ban-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Anulo</AlertDialogCancel>
          <Button variant="destructive" onClick={ban} disabled={pending}>
            {pending && <Spinner />} Blloko
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const remove = () =>
    startTransition(async () => {
      const res = await deleteUser({ userId: user.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Përdoruesi u fshi.");
      onClose();
    });
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Fshi {user.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Llogaria {user.email} fshihet përgjithmonë së bashku me anëtarësitë në dyqane dhe tiketat që ka hapur.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Anulo</AlertDialogCancel>
          <Button variant="destructive" onClick={remove} disabled={pending}>
            {pending && <Spinner />} Fshi
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
