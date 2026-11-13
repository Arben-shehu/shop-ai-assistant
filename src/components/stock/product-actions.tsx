"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { deleteProduct } from "@/app/(app)/stock/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProductDialog } from "./product-dialog";
import type { ProductFormData } from "./product-schema";

export function NewProductButton({ categories, brands }: { categories: string[]; brands: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        Produkt i ri
      </Button>
      <ProductDialog open={open} onOpenChange={setOpen} categories={categories} brands={brands} />
    </>
  );
}

export function ProductActions({
  product,
  categories,
  brands,
}: {
  product: ProductFormData;
  categories: string[];
  brands: string[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    startTransition(async () => {
      const res = await deleteProduct({ productId: product.id });
      if (res.ok) {
        toast.success(res.message);
        setDeleteOpen(false);
      } else toast.error(res.error);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Veprime për ${product.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <PencilIcon />
            Ndrysho
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2Icon />
            Fshi
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProductDialog open={editOpen} onOpenChange={setEditOpen} product={product} categories={categories} brands={brands} />

      <AlertDialog open={deleteOpen} onOpenChange={(o) => !pending && setDeleteOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Të fshihet &quot;{product.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Nëse produkti gjendet në ndonjë porosi, ai vetëm do të çaktivizohet që historiku i porosive të mbetet i
              plotë. Përndryshe fshihet përfundimisht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Anulo</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                onDelete();
              }}
            >
              Fshi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
