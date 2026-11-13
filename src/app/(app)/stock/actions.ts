"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrg } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { hasInventorySource } from "@/lib/inventory/source";
import { productInputSchema, type ProductFieldErrors, type ProductInput } from "@/components/stock/product-schema";

// Every action here is shop-admin only: requireOrg({ minRole: "admin" }) redirects operators to /unauthorized
// before anything is read or written. It is called outside try/catch so the redirect is never swallowed.
// (No `product` LiveEvent exists yet, so these only revalidate /stock.)

export type ActionResult<T = object> =
  | ({ ok: true; message: string } & T)
  | { ok: false; error: string; fieldErrors?: ProductFieldErrors };

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
// Shops with their own DB: products are a mirror of live reads; local edits would be overwritten or never searched.
const EXTERNAL = { ok: false as const, error: "Inventari i këtij dyqani lexohet nga DB e tyre. Ndryshimet bëhen atje." };
const SKU_TAKEN = "Ky SKU përdoret tashmë nga një produkt tjetër në dyqan.";

export async function saveProduct(input: ProductInput): Promise<ActionResult<{ id: string }>> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  if (await hasInventorySource(orgId)) return EXTERNAL;
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
    const fieldErrors: ProductFieldErrors = {};
    for (const [k, v] of Object.entries(flat)) if (v?.[0]) fieldErrors[k as keyof ProductFieldErrors] = v[0];
    return { ok: false, error: "Kontrolloni fushat e shënuara.", fieldErrors };
  }
  const { id, attributes, originalStock, ...p } = parsed.data;
  const data = {
    ...p,
    attributes: attributes.length ? Object.fromEntries(attributes.map((a) => [a.key, a.value])) : Prisma.DbNull,
  };

  let productId: string;
  try {
    if (id) {
      const { stock, ...rest } = data;
      const res = await prisma.product.updateMany({
        where: { id, organizationId: orgId },
        data: stock === originalStock ? rest : data,
      });
      if (res.count !== 1) return { ok: false, error: "Produkti nuk u gjet." };
      productId = id;
    } else {
      productId = (await prisma.product.create({ data: { ...data, organizationId: orgId }, select: { id: true } })).id;
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: SKU_TAKEN, fieldErrors: { sku: SKU_TAKEN } };
    throw e;
  }

  await logActivity({
    orgId,
    userId: user.id,
    action: id ? "product.updated" : "product.created",
    entityType: "product",
    entityId: productId,
    meta: { name: p.name, sku: p.sku },
  });
  revalidatePath("/stock");
  return { ok: true, id: productId, message: id ? "Produkti u përditësua." : "Produkti u shtua." };
}

const adjustInput = z.object({ productId: z.string().min(1).max(64), delta: z.number().int().min(-10_000).max(10_000).refine((d) => d !== 0) });

/** Atomic +/- on stock; never goes below zero. */
export async function adjustStock(input: z.input<typeof adjustInput>): Promise<ActionResult<{ stock: number }>> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  if (await hasInventorySource(orgId)) return EXTERNAL;
  const parsed = adjustInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Të dhëna të pavlefshme." };
  const { productId, delta } = parsed.data;

  const res = await prisma.product.updateMany({
    where: { id: productId, organizationId: orgId, ...(delta < 0 ? { stock: { gte: -delta } } : {}) },
    data: { stock: { increment: delta } },
  });
  const product = await prisma.product.findFirst({ where: { id: productId, organizationId: orgId }, select: { stock: true, name: true } });
  if (!product) return { ok: false, error: "Produkti nuk u gjet." };
  if (res.count !== 1) return { ok: false, error: "Stoku nuk mund të jetë negativ." };

  await logActivity({
    orgId,
    userId: user.id,
    action: "product.stock_adjusted",
    entityType: "product",
    entityId: productId,
    meta: { delta, stock: product.stock },
  });
  revalidatePath("/stock");
  return { ok: true, stock: product.stock, message: `Stoku i "${product.name}": ${product.stock}` };
}

const activeInput = z.object({ productId: z.string().min(1).max(64), isActive: z.boolean() });

export async function setProductActive(input: z.input<typeof activeInput>): Promise<ActionResult> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  if (await hasInventorySource(orgId)) return EXTERNAL;
  const parsed = activeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Të dhëna të pavlefshme." };
  const { productId, isActive } = parsed.data;

  const res = await prisma.product.updateMany({ where: { id: productId, organizationId: orgId }, data: { isActive } });
  if (res.count !== 1) return { ok: false, error: "Produkti nuk u gjet." };

  await logActivity({
    orgId,
    userId: user.id,
    action: isActive ? "product.activated" : "product.deactivated",
    entityType: "product",
    entityId: productId,
  });
  revalidatePath("/stock");
  return { ok: true, message: isActive ? "Produkti u aktivizua." : "Produkti u çaktivizua (asistenti nuk e ofron më)." };
}

const deleteInput = z.object({ productId: z.string().min(1).max(64) });

/**
 * Hard delete only when no order ever referenced the product. Otherwise archive (isActive = false):
 * OrderItem.product is onDelete: SetNull, so the DB itself would happily drop the link to order history.
 */
export async function deleteProduct(input: z.input<typeof deleteInput>): Promise<ActionResult<{ mode: "deleted" | "archived" }>> {
  const { orgId, user } = await requireOrg({ minRole: "admin" });
  if (await hasInventorySource(orgId)) return EXTERNAL;
  const parsed = deleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Të dhëna të pavlefshme." };
  const { productId } = parsed.data;

  const mode = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, organizationId: orgId },
      select: { _count: { select: { orderItems: true } } },
    });
    if (!product) return null;
    if (product._count.orderItems > 0) {
      await tx.product.update({ where: { id: productId }, data: { isActive: false } });
      return "archived" as const;
    }
    await tx.product.delete({ where: { id: productId } });
    return "deleted" as const;
  });
  if (!mode) return { ok: false, error: "Produkti nuk u gjet." };

  await logActivity({
    orgId,
    userId: user.id,
    action: mode === "deleted" ? "product.deleted" : "product.archived",
    entityType: "product",
    entityId: productId,
  });
  revalidatePath("/stock");
  return {
    ok: true,
    mode,
    message: mode === "deleted" ? "Produkti u fshi." : "Produkti ka porosi, prandaj u çaktivizua në vend që të fshihej.",
  };
}
