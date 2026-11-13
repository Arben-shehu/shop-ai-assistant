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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addOperator } from "@/app/(app)/operators/actions";

export function AddOperatorDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode("new");
    setRole("member");
    setError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    const user =
      mode === "existing"
        ? { mode, email: get("existingEmail") }
        : { mode, name: get("name"), email: get("email"), password: get("password") };
    setError(null);
    startTransition(async () => {
      const res = await addOperator({ role, user });
      if (!res.ok) return setError(res.error);
      toast.success("Operatori u shtua.");
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Shto operator
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Shto operator</DialogTitle>
          <DialogDescription>Krijoni një llogari të re ose shtoni një përdorues që ekziston tashmë.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Tabs value={mode} onValueChange={(v) => setMode(v as "new" | "existing")}>
              <TabsList className="w-full">
                <TabsTrigger value="new">Llogari e re</TabsTrigger>
                <TabsTrigger value="existing">Përdorues ekzistues</TabsTrigger>
              </TabsList>
              <TabsContent value="new" className="pt-3">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="op-name">Emri</FieldLabel>
                    <Input id="op-name" name="name" required={mode === "new"} minLength={2} maxLength={100} autoComplete="off" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="op-email">Email</FieldLabel>
                    <Input id="op-email" name="email" type="email" required={mode === "new"} autoComplete="off" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="op-password">Fjalëkalimi</FieldLabel>
                    <Input id="op-password" name="password" type="password" required={mode === "new"} minLength={8} autoComplete="new-password" />
                    <FieldDescription>Të paktën 8 karaktere. Ndajeni me operatorin në mënyrë të sigurt.</FieldDescription>
                  </Field>
                </FieldGroup>
              </TabsContent>
              <TabsContent value="existing" className="pt-3">
                <Field>
                  <FieldLabel htmlFor="op-existing">Email i përdoruesit</FieldLabel>
                  <Input id="op-existing" name="existingEmail" type="email" required={mode === "existing"} autoComplete="off" />
                </Field>
              </TabsContent>
            </Tabs>
            <Field>
              <FieldLabel htmlFor="op-role">Roli</FieldLabel>
              <Select value={role} onValueChange={(v) => setRole(v as "member" | "admin")}>
                <SelectTrigger id="op-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Operator — bisedat dhe porositë</SelectItem>
                  <SelectItem value="admin">Administrator — edhe kanalet, operatorët, cilësimet</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} Shto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
