"use client";
import { useState, useTransition } from "react";
import { Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { changeOperatorRole, removeOperator } from "@/app/(app)/operators/actions";
import { SHOP_ROLE_LABELS } from "@/components/admin/types";

export type OperatorRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  joinedAt: string;
  self: boolean;
  locked: boolean;
};

export function OperatorsTable({ rows }: { rows: OperatorRow[] }) {
  const [removing, setRemoving] = useState<OperatorRow | null>(null);
  const [pending, startTransition] = useTransition();

  function changeRole(row: OperatorRow, role: string) {
    if (role !== "member" && role !== "admin") return;
    startTransition(async () => {
      const res = await changeOperatorRole({ memberId: row.id, role });
      if (res.ok) toast.success("Roli u ndryshua.");
      else toast.error(res.error);
    });
  }

  function remove() {
    if (!removing) return;
    const row = removing;
    startTransition(async () => {
      const res = await removeOperator({ memberId: row.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Operatori u hoq nga dyqani.");
      setRemoving(null);
    });
  }

  if (rows.length === 0)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Users />
          </EmptyMedia>
          <EmptyTitle>Ende pa operatorë</EmptyTitle>
          <EmptyDescription>Shtoni operatorin e parë për t’iu përgjigjur klientëve.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  return (
    <>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Anëtari</TableHead>
              <TableHead>Roli</TableHead>
              <TableHead className="hidden md:table-cell">Shtuar</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Veprime</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {row.name}
                    {row.self && <Badge variant="secondary">Ju</Badge>}
                    {row.banned && <Badge variant="destructive">I bllokuar</Badge>}
                  </div>
                  <div className="text-muted-foreground text-xs">{row.email}</div>
                </TableCell>
                <TableCell>
                  {row.locked ? (
                    <Badge variant={row.role === "owner" ? "default" : "outline"}>{SHOP_ROLE_LABELS[row.role] ?? row.role}</Badge>
                  ) : (
                    <Select value={row.role} onValueChange={(v) => changeRole(row, v)} disabled={pending}>
                      <SelectTrigger size="sm" className="w-40" aria-label={`Roli i ${row.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {row.role === "owner" && <SelectItem value="owner">{SHOP_ROLE_LABELS.owner}</SelectItem>}
                        <SelectItem value="admin">{SHOP_ROLE_LABELS.admin}</SelectItem>
                        <SelectItem value="member">{SHOP_ROLE_LABELS.member}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground hidden md:table-cell">{row.joinedAt}</TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={row.locked || pending}
                    onClick={() => setRemoving(row)}
                    aria-label={`Hiq ${row.name}`}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hiq {removing?.name} nga dyqani?</AlertDialogTitle>
            <AlertDialogDescription>
              Llogaria nuk fshihet, por nuk do të ketë më akses në këtë dyqan. Bisedat e caktuara atij mbeten pa operator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Anulo</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending && <Spinner />} Hiq
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
