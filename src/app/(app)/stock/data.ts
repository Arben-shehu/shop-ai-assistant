import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/format";
import { attributesToRows, LOW_STOCK, STOCK_FILTERS, type StockFilter } from "@/components/stock/product-schema";
import type { ProductRowData } from "@/components/stock/products-table";

export type StockFilters = { q: string; category: string | null; filter: StockFilter; page: number };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseStockFilters(sp: Record<string, string | string[] | undefined>): StockFilters {
  const filter = first(sp.filter);
  const page = Number.parseInt(first(sp.page), 10);
  return {
    q: first(sp.q).trim().slice(0, 100),
    category: first(sp.category).trim().slice(0, 100) || null,
    filter: Object.hasOwn(STOCK_FILTERS, filter) ? (filter as StockFilter) : "all",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

function productWhere(orgId: string, f: StockFilters): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { organizationId: orgId };
  if (f.category) where.category = f.category;
  if (f.q) {
    where.OR = [
      { name: { contains: f.q, mode: "insensitive" } },
      { sku: { contains: f.q, mode: "insensitive" } },
      { brand: { contains: f.q, mode: "insensitive" } },
    ];
  }
  if (f.filter === "low") Object.assign(where, { isActive: true, stock: { gt: 0, lte: LOW_STOCK } });
  if (f.filter === "out") Object.assign(where, { isActive: true, stock: { lte: 0 } });
  if (f.filter === "inactive") where.isActive = false;
  return where;
}

/** Low/out-of-stock count only active products (inactive ones are not sold); inventory value counts everything on the shelf. */
export async function getStockSummary(orgId: string, currency: string) {
  const [total, active, out, low, [value]] = await Promise.all([
    prisma.product.count({ where: { organizationId: orgId } }),
    prisma.product.count({ where: { organizationId: orgId, isActive: true } }),
    prisma.product.count({ where: { organizationId: orgId, isActive: true, stock: { lte: 0 } } }),
    prisma.product.count({ where: { organizationId: orgId, isActive: true, stock: { gt: 0, lte: LOW_STOCK } } }),
    prisma.$queryRaw<{ value: Prisma.Decimal | null; units: bigint | null }[]>`
      SELECT SUM(price * stock) AS value, SUM(stock) AS units
      FROM "Product" WHERE "organizationId" = ${orgId} AND stock > 0`,
  ]);
  return {
    total,
    active,
    out,
    low,
    valueLabel: formatMoney(value?.value ?? 0, currency),
    units: Number(value?.units ?? 0),
  };
}

export async function getProductRows(orgId: string, f: StockFilters, pageSize: number, currency: string) {
  const where = productWhere(orgId, f);
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (f.page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const rows: ProductRowData[] = products.map((p) => ({
    priceLabel: formatMoney(p.price, currency),
    form: {
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: p.price.toFixed(2),
      stock: p.stock,
      category: p.category,
      brand: p.brand,
      description: p.description,
      imageUrl: p.imageUrl,
      isActive: p.isActive,
      attributes: attributesToRows(p.attributes),
    },
  }));
  return { total, rows };
}

/** Distinct categories and brands (filter + form suggestions). */
export async function getProductFacets(orgId: string) {
  const [cats, brands] = await Promise.all([
    prisma.product.groupBy({ by: ["category"], where: { organizationId: orgId, category: { not: null } }, orderBy: { category: "asc" } }),
    prisma.product.groupBy({ by: ["brand"], where: { organizationId: orgId, brand: { not: null } }, orderBy: { brand: "asc" } }),
  ]);
  return {
    categories: cats.map((c) => c.category!).filter(Boolean),
    brands: brands.map((b) => b.brand!).filter(Boolean),
  };
}
