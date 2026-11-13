"use client";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createShop } from "@/app/(app)/admin/businesses/actions";
import { slugify } from "@/components/admin/types";

export function CreateBusinessDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setMode("new");
    setError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    const owner =
      mode === "existing"
        ? { mode, email: get("existingEmail") }
        : { mode, name: get("ownerName"), email: get("ownerEmail"), password: get("ownerPassword") };
    setError(null);
    startTransition(async () => {
      const res = await createShop({ name, slug, owner });
      if (!res.ok) return setError(res.error);
      toast.success("Dyqani u krijua.");
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Dyqan i ri
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Krijo dyqan</DialogTitle>
          <DialogDescription>Dyqani krijohet me një pronar. Pronari mund të shtojë operatorë më vonë.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="shop-name">Emri i dyqanit</FieldLabel>
              <Input
                id="shop-name"
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="shop-slug">Slug</FieldLabel>
              <Input
                id="shop-slug"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
              />
              <FieldDescription>Identifikues unik: shkronja të vogla, numra dhe viza.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Pronari</FieldLabel>
              <Tabs value={mode} onValueChange={(v) => setMode(v as "existing" | "new")}>
                <TabsList className="w-full">
                  <TabsTrigger value="new">Përdorues i ri</TabsTrigger>
                  <TabsTrigger value="existing">Përdorues ekzistues</TabsTrigger>
                </TabsList>
                <TabsContent value="new" className="pt-3">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="owner-name">Emri i pronarit</FieldLabel>
                      <Input id="owner-name" name="ownerName" required={mode === "new"} minLength={2} autoComplete="off" />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="owner-email">Email</FieldLabel>
                      <Input id="owner-email" name="ownerEmail" type="email" required={mode === "new"} autoComplete="off" />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="owner-password">Fjalëkalimi</FieldLabel>
                      <Input id="owner-password" name="ownerPassword" type="password" required={mode === "new"} minLength={8} autoComplete="new-password" />
                      <FieldDescription>Të paktën 8 karaktere.</FieldDescription>
                    </Field>
                  </FieldGroup>
                </TabsContent>
                <TabsContent value="existing" className="pt-3">
                  <Field>
                    <FieldLabel htmlFor="existing-email">Email i përdoruesit</FieldLabel>
                    <Input id="existing-email" name="existingEmail" type="email" required={mode === "existing"} autoComplete="off" />
                  </Field>
                </TabsContent>
              </Tabs>
            </Field>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} Krijo dyqanin
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
