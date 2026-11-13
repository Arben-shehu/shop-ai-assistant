// Pure SQL building for a shop's own inventory DB. The admin-written SELECT is wrapped as a subquery; model-provided
// terms only ever travel as bound parameters.

export type Dialect = "POSTGRES" | "MYSQL" | "MSSQL";

export const REQUIRED_COLUMNS = ["sku", "name", "price", "stock"] as const;
const SEARCHABLE = ["name", "sku", "brand", "category", "description"];
const KNOWN = new Set([...REQUIRED_COLUMNS, "category", "brand", "description", "image_url"]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type Built = { sql: string; params: string[] };

/** Admin query must be a single plain SELECT (MSSQL forbids CTEs and ORDER BY inside a subquery). */
export function checkQuery(query: string): string {
  const q = query.trim().replace(/\s*;\s*$/, "");
  if (!/^select\s/i.test(q)) throw new Error("Query duhet të fillojë me SELECT.");
  if (q.includes(";")) throw new Error("Query duhet të jetë një SELECT i vetëm (pa ';').");
  return q;
}

/** Map our logical names (sku, name...) to the column names the query actually returns (case differs by engine). */
export function columnMap(columns: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of columns) if (IDENT.test(c) && !m.has(c.toLowerCase())) m.set(c.toLowerCase(), c);
  return m;
}

export function missingRequired(columns: string[]): string[] {
  const m = columnMap(columns);
  return REQUIRED_COLUMNS.filter((c) => !m.has(c));
}

const quote = (d: Dialect, c: string) => (d === "POSTGRES" ? `"${c}"` : d === "MYSQL" ? `\`${c}\`` : `[${c}]`);
const asText = (d: Dialect, col: string) =>
  `CAST(${col} AS ${d === "POSTGRES" ? "TEXT" : d === "MYSQL" ? "CHAR" : "NVARCHAR(MAX)"})`;
const placeholder = (d: Dialect, n: number) => (d === "POSTGRES" ? `$${n}` : d === "MYSQL" ? "?" : `@p${n}`);
const escapeLike = (v: string) => v.replace(/[!%_[]/g, "!$&");

function wrap(d: Dialect, query: string, where: string, limit: number) {
  const q = checkQuery(query);
  const lim = Math.max(1, Math.min(500, Math.floor(limit)));
  return d === "MSSQL"
    ? `SELECT TOP (${lim}) * FROM (${q}) AS inv${where ? ` WHERE ${where}` : ""}`
    : `SELECT * FROM (${q}) AS inv${where ? ` WHERE ${where}` : ""} LIMIT ${lim}`;
}

/** Rows where any searchable column contains any of the term variants (ranking happens later, in our DB). */
export function buildSearch(d: Dialect, query: string, columns: string[], terms: string[], limit: number): Built | null {
  const m = columnMap(columns);
  const cols = SEARCHABLE.map((c) => m.get(c)).filter((c): c is string => Boolean(c));
  const uniq = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].slice(0, 40);
  if (!uniq.length || !cols.length) return null;
  const params: string[] = [];
  const like = d === "POSTGRES" ? "ILIKE" : "LIKE"; // MySQL/MSSQL default collations are case-insensitive
  const ors = uniq.flatMap((t) => {
    params.push(`%${escapeLike(t)}%`);
    const p = placeholder(d, params.length);
    return cols.map((c) => `${asText(d, quote(d, c))} ${like} ${p} ESCAPE '!'`);
  });
  // MySQL "?" placeholders are positional: repeat each param once per column.
  const finalParams = d === "MYSQL" ? params.flatMap((p) => cols.map(() => p)) : params;
  return { sql: wrap(d, query, ors.join(" OR "), limit), params: finalParams };
}

export function buildBySku(d: Dialect, query: string, columns: string[], skus: string[]): Built {
  const sku = columnMap(columns).get("sku");
  if (!sku) throw new Error("Query nuk kthen kolonën sku.");
  const params = skus.slice(0, 50);
  const list = params.map((_, i) => placeholder(d, i + 1)).join(", ");
  return { sql: wrap(d, query, `${asText(d, quote(d, sku))} IN (${list})`, params.length || 1), params };
}

export function buildSample(d: Dialect, query: string, limit = 5): Built {
  return { sql: wrap(d, query, "", limit), params: [] };
}

export type InventoryRow = {
  sku: string;
  name: string;
  price: string;
  stock: number;
  category: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  attributes: Record<string, string | number | boolean> | null;
};

const str = (v: unknown, max: number) => (v === null || v === undefined || v === "" ? null : String(v).trim().slice(0, max) || null);

/** Normalise one driver row (decimals may be strings, keys may be any case). Returns null for unusable rows. */
export function normalizeRow(raw: Record<string, unknown>): InventoryRow | null {
  const r = new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v] as const));
  const sku = str(r.get("sku"), 100);
  const name = str(r.get("name"), 300);
  const price = Number(String(r.get("price") ?? "").replace(",", "."));
  if (!sku || !name || !Number.isFinite(price) || price < 0) return null;
  const stock = Number(r.get("stock"));
  const attributes: Record<string, string | number | boolean> = {};
  for (const [k, v] of r) {
    if (KNOWN.has(k) || v === null || v === undefined) continue;
    if (v instanceof Date) attributes[k] = v.toISOString().slice(0, 10);
    else if (["string", "number", "boolean"].includes(typeof v)) attributes[k] = typeof v === "string" ? v.slice(0, 200) : (v as number | boolean);
  }
  return {
    sku,
    name,
    price: price.toFixed(2),
    stock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
    category: str(r.get("category"), 100),
    brand: str(r.get("brand"), 100),
    description: str(r.get("description"), 4000),
    imageUrl: str(r.get("image_url"), 1000),
    attributes: Object.keys(attributes).length ? attributes : null,
  };
}
