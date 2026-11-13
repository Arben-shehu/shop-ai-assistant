"use client";
import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { createUser } from "@/app/(app)/admin/users/actions";
import { SHOP_ROLE_LABELS } from "@/components/admin/types";

const NO_SHOP = "__none__";

export function CreateUserDialog({ shops }: { shops: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<"user" | "admin">("user");
  const [shopId, setShopId] = useState(NO_SHOP);
  const [shopRole, setShopRole] = useState<"owner" | "admin" | "member">("member");

  function reset() {
    setError(null);
    setRole("user");
    setShopId(NO_SHOP);
    setShopRole("member");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createUser({
        name: String(f.get("name")),
        email: String(f.get("email")),
        password: String(f.get("password")),
        role,
        shopId: shopId === NO_SHOP ? undefined : shopId,
        shopRole,
      });
      if (!res.ok) return setError(res.error);
      toast.success("Përdoruesi u krijua.");
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Përdorues i ri
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Krijo përdorues</DialogTitle>
          <DialogDescription>Llogaritë krijohen vetëm nga administratorët. Ndani fjalëkalimin me përdoruesin në mënyrë të sigurt.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="u-name">Emri</FieldLabel>
              <Input id="u-name" name="name" required minLength={2} maxLength={100} autoComplete="off" />
            </Field>
            <Field>
              <FieldLabel htmlFor="u-email">Email</FieldLabel>
              <Input id="u-email" name="email" type="email" required autoComplete="off" />
            </Field>
            <Field>
              <FieldLabel htmlFor="u-password">Fjalëkalimi</FieldLabel>
              <Input id="u-password" name="password" type="password" required minLength={8} autoComplete="new-password" />
              <FieldDescription>Të paktën 8 karaktere.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="u-role">Roli në platformë</FieldLabel>
              <Select value={role} onValueChange={(v) => setRole(v as "user" | "admin")}>
                <SelectTrigger id="u-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Përdorues</SelectItem>
                  <SelectItem value="admin">Administrator i platformës</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="u-shop">Dyqani (opsional)</FieldLabel>
                <Select value={shopId} onValueChange={setShopId}>
                  <SelectTrigger id="u-shop" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SHOP}>Asnjë</SelectItem>
                    {shops.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="u-shop-role">Roli në dyqan</FieldLabel>
                <Select value={shopRole} onValueChange={(v) => setShopRole(v as typeof shopRole)} disabled={shopId === NO_SHOP}>
                  <SelectTrigger id="u-shop-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["member", "admin", "owner"] as const).map((r) => (
                      <SelectItem key={r} value={r}>{SHOP_ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} Krijo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
