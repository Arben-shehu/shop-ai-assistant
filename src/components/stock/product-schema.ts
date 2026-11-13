import { z } from "zod";

// Plain module: used by the server actions (validation) and the client form (types/constants).

export const LOW_STOCK = 3;
export const PRODUCTS_PAGE_SIZE = 20;

export const STOCK_FILTERS = { all: "Të gjitha", low: "Stok i ulët", out: "Pa stok", inactive: "Joaktive" } as const;
export type StockFilter = keyof typeof STOCK_FILTERS;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maksimumi ${max} karaktere`)
    .transform((v) => v || null);

export const productInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1, "Emri është i detyrueshëm").max(200, "Maksimumi 200 karaktere"),
  sku: z
    .string()
    .trim()
    .min(1, "SKU është i detyrueshëm")
    .max(64, "Maksimumi 64 karaktere")
    .regex(/^\S+$/, "SKU nuk mund të ketë hapësira"),
  price: z
    .string()
    .trim()
    .transform((v) => v.replace(",", "."))
    .pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "Çmim i pavlefshëm (p.sh. 499.99)")),
  stock: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce
      .number({ error: "Sasia është e detyrueshme" })
      .int("Sasia duhet të jetë numër i plotë")
      .min(0, "Sasia nuk mund të jetë negative")
      .max(1_000_000, "Sasi shumë e madhe"),
  ),
  /** Stock the edit form was opened with: if unchanged, an edit leaves stock alone (orders may have moved it meanwhile). */
  originalStock: z.number().int().optional(),
  category: optionalText(100),
  brand: optionalText(100),
  description: optionalText(5000),
  imageUrl: optionalText(2000).refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), "Duhet të jetë një URL http(s)"),
  isActive: z.boolean().default(true),
  attributes: z
    .array(z.object({ key: z.string().trim().max(60, "Çelësi: maks. 60 karaktere"), value: z.string().trim().max(500) }))
    .max(50, "Maksimumi 50 atribute")
    .transform((rows) => rows.filter((r) => r.key))
    .refine((rows) => new Set(rows.map((r) => r.key.toLowerCase())).size === rows.length, "Çelësat e atributeve përsëriten"),
});

export type ProductInput = z.input<typeof productInputSchema>;
export type ProductFieldErrors = Partial<Record<keyof ProductInput, string>>;

/** Product as the edit form needs it (money as string). */
export type ProductFormData = {
  id: string;
  name: string;
  sku: string;
  price: string;
  stock: number;
  category: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  attributes: { key: string; value: string }[];
};

/** Prisma Json -> editable rows (only flat scalar values are shown as text). */
export function attributesToRows(json: unknown): { key: string; value: string }[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  return Object.entries(json as Record<string, unknown>).map(([key, v]) => ({
    key,
    value: typeof v === "string" ? v : JSON.stringify(v),
  }));
}
