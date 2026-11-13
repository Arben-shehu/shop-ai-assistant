"use client";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { saveProduct } from "@/app/(app)/stock/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ProductFieldErrors, ProductFormData } from "./product-schema";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create a new product. */
  product?: ProductFormData;
  categories: string[];
  brands: string[];
};

/** Create/edit dialog. The form unmounts when closed, so it always starts from `product`. */
export function ProductDialog({ open, onOpenChange, product, categories, brands }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogClose asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="Mbyll">
            <XIcon />
          </Button>
        </DialogClose>
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{product ? "Ndrysho produktin" : "Produkt i ri"}</DialogTitle>
          <DialogDescription>
            {product ? `${product.name} · ${product.sku}` : "Asistenti AI përdor këto të dhëna kur u përgjigjet klientëve."}
          </DialogDescription>
        </DialogHeader>
        <ProductForm product={product} categories={categories} brands={brands} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

let rowSeq = 0;
type AttrRow = { rid: number; key: string; value: string };
const toRows = (attrs: { key: string; value: string }[]): AttrRow[] => attrs.map((a) => ({ rid: ++rowSeq, ...a }));

function ProductForm({
  product,
  categories,
  brands,
  onDone,
}: {
  product?: ProductFormData;
  categories: string[];
  brands: string[];
  onDone: () => void;
}) {
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<ProductFieldErrors>({});
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [attrs, setAttrs] = useState<AttrRow[]>(() => toRows(product?.attributes ?? []));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? "");
    startTransition(async () => {
      const res = await saveProduct({
        id: product?.id,
        name: text("name"),
        sku: text("sku"),
        price: text("price"),
        stock: text("stock"),
        originalStock: product?.stock,
        category: text("category"),
        brand: text("brand"),
        description: text("description"),
        imageUrl: text("imageUrl"),
        isActive,
        attributes: attrs.map(({ key, value }) => ({ key, value })),
      });
      if (res.ok) {
        toast.success(res.message);
        onDone();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });
  }

  const field = (name: keyof ProductFieldErrors) => ({
    id: `${uid}-${name}`,
    name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${uid}-${name}-err` : undefined,
  });
  const err = (name: keyof ProductFieldErrors) =>
    errors[name] ? <FieldError id={`${uid}-${name}-err`}>{errors[name]}</FieldError> : null;

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col" noValidate>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup className="gap-4">
          <Field data-invalid={!!errors.name || undefined}>
            <FieldLabel htmlFor={`${uid}-name`}>Emri</FieldLabel>
            <Input {...field("name")} defaultValue={product?.name} required maxLength={200} autoFocus={!product} />
            {err("name")}
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field data-invalid={!!errors.sku || undefined}>
              <FieldLabel htmlFor={`${uid}-sku`}>SKU</FieldLabel>
              <Input {...field("sku")} defaultValue={product?.sku} required maxLength={64} autoComplete="off" />
              {err("sku")}
            </Field>
            <Field data-invalid={!!errors.price || undefined}>
              <FieldLabel htmlFor={`${uid}-price`}>Çmimi</FieldLabel>
              <Input {...field("price")} defaultValue={product?.price} required inputMode="decimal" placeholder="0.00" />
              {err("price")}
            </Field>
            <Field data-invalid={!!errors.stock || undefined}>
              <FieldLabel htmlFor={`${uid}-stock`}>Stoku</FieldLabel>
              <Input {...field("stock")} defaultValue={product?.stock ?? 0} type="number" min={0} step={1} required />
              {err("stock")}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.category || undefined}>
              <FieldLabel htmlFor={`${uid}-category`}>Kategoria</FieldLabel>
              <Input {...field("category")} defaultValue={product?.category ?? ""} list={`${uid}-cats`} autoComplete="off" />
              <datalist id={`${uid}-cats`}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {err("category")}
            </Field>
            <Field data-invalid={!!errors.brand || undefined}>
              <FieldLabel htmlFor={`${uid}-brand`}>Marka</FieldLabel>
              <Input {...field("brand")} defaultValue={product?.brand ?? ""} list={`${uid}-brands`} autoComplete="off" />
              <datalist id={`${uid}-brands`}>
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              {err("brand")}
            </Field>
          </div>

          <Field data-invalid={!!errors.description || undefined}>
            <FieldLabel htmlFor={`${uid}-description`}>Përshkrimi</FieldLabel>
            <Textarea {...field("description")} defaultValue={product?.description ?? ""} rows={3} maxLength={5000} />
            {err("description")}
          </Field>

          <Field data-invalid={!!errors.imageUrl || undefined}>
            <FieldLabel htmlFor={`${uid}-imageUrl`}>URL e fotos</FieldLabel>
            <Input {...field("imageUrl")} defaultValue={product?.imageUrl ?? ""} type="url" placeholder="https://…" />
            {err("imageUrl")}
          </Field>

          <FieldSet className="gap-2">
            <FieldLegend variant="label">Specifikimet</FieldLegend>
            <FieldDescription>P.sh. RAM → 16GB, Ekrani → 15.6&quot; FHD. Asistenti i përdor për të krahasuar produktet.</FieldDescription>
            {attrs.length > 0 && (
              <ul className="space-y-2">
                {attrs.map((a, i) => (
                  <li key={a.rid} className="flex items-center gap-2">
                    <Input
                      aria-label={`Atributi ${i + 1}: emri`}
                      placeholder="Emri"
                      value={a.key}
                      maxLength={60}
                      className="w-2/5"
                      onChange={(e) => setAttrs((rows) => rows.map((r) => (r.rid === a.rid ? { ...r, key: e.target.value } : r)))}
                    />
                    <Input
                      aria-label={`Atributi ${i + 1}: vlera`}
                      placeholder="Vlera"
                      value={a.value}
                      maxLength={500}
                      className="flex-1"
                      onChange={(e) => setAttrs((rows) => rows.map((r) => (r.rid === a.rid ? { ...r, value: e.target.value } : r)))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Hiq atributin ${a.key || i + 1}`}
                      onClick={() => setAttrs((rows) => rows.filter((r) => r.rid !== a.rid))}
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAttrs((rows) => [...rows, { rid: ++rowSeq, key: "", value: "" }])}
              >
                <PlusIcon data-icon="inline-start" />
                Shto atribut
              </Button>
            </div>
            {errors.attributes && <FieldError>{errors.attributes}</FieldError>}
          </FieldSet>

          <Field orientation="horizontal">
            <Switch id={`${uid}-active`} checked={isActive} onCheckedChange={setIsActive} />
            <FieldLabel htmlFor={`${uid}-active`} className="font-normal">
              Aktiv — asistenti mund ta ofrojë te klientët
            </FieldLabel>
          </Field>
        </FieldGroup>
      </div>
      <DialogFooter className="border-t p-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Anulo
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" aria-label="Duke ruajtur" />}
          {product ? "Ruaj ndryshimet" : "Shto produktin"}
        </Button>
      </DialogFooter>
    </form>
  );
}
