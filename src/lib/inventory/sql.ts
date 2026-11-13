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

const MAX_GROUPS = 8;
const MAX_VARIANTS = 8;

function wrap(d: Dialect, query: string, where: string, limit: number, orderBy?: string) {
  const q = checkQuery(query);
  const lim = Math.max(1, Math.min(500, Math.floor(limit)));
  const tail = `${where ? ` WHERE ${where}` : ""}${orderBy ? ` ORDER BY ${orderBy}` : ""}`;
  return d === "MSSQL" ? `SELECT TOP (${lim}) * FROM (${q}) AS inv${tail}` : `SELECT * FROM (${q}) AS inv${tail} LIMIT ${lim}`;
}

/**
 * Live product search. AND across groups (each group = one query word or filter: OR of its variants over every
 * searchable column), or OR of every variant when mode = "any" (the fallback when AND finds nothing). Ordered by
 * name so a capped result is deterministic; ranking happens later, in our DB.
 */
export function buildSearch(
  d: Dialect,
  query: string,
  columns: string[],
  groups: string[][],
  limit: number,
  mode: "all" | "any" = "all",
): Built | null {
  const m = columnMap(columns);
  const cols = SEARCHABLE.map((c) => m.get(c)).filter((c): c is string => Boolean(c));
  const clean = groups
    .map((g) => [...new Set(g.map((t) => t.trim()).filter(Boolean))].slice(0, MAX_VARIANTS))
    .filter((g) => g.length)
    .slice(0, MAX_GROUPS);
  if (!clean.length || !cols.length) return null;
  const params: string[] = [];
  const like = d === "POSTGRES" ? "ILIKE" : "LIKE"; // MySQL/MSSQL default collations are case-insensitive
  const variant = (t: string) => {
    params.push(`%${escapeLike(t)}%`);
    const p = placeholder(d, params.length);
    // MySQL "?" placeholders are positional: repeat the param once per column.
    if (d === "MYSQL") for (let i = 1; i < cols.length; i++) params.push(params[params.length - 1]);
    return cols.map((c) => `${asText(d, quote(d, c))} ${like} ${p} ESCAPE '!'`);
  };
  const where =
    mode === "all"
      ? clean.map((g) => `(${g.flatMap(variant).join(" OR ")})`).join(" AND ")
      : [...new Set(clean.flat())].flatMap(variant).join(" OR ");
  const name = m.get("name");
  return { sql: wrap(d, query, where, limit, name ? quote(d, name) : undefined), params };
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

// ---------------------------------------------------------------------------------------------------------------
// Named ERP queries (customer / history / order status): admin-written SELECTs with :phone, :client_id or :ref.
// The values come from our server (the WhatsApp sender, the ERP client id read for that sender, our order number),
// never from the model, and always travel as bound parameters.
// ---------------------------------------------------------------------------------------------------------------

export const NAMED_PARAMS = ["phone", "client_id", "ref"] as const;
export type NamedParam = (typeof NAMED_PARAMS)[number];
const isNamed = (n: string): n is NamedParam => (NAMED_PARAMS as readonly string[]).includes(n);

type Token = { start: number; end: number; name: string };

/** :name tokens outside string literals, quoted identifiers and comments. `::type` casts and MySQL `:=` are not params. */
function scanNamed(d: Dialect, sql: string): Token[] {
  const out: Token[] = [];
  const skipTo = (from: number, close: string, backslash = false) => {
    for (let j = from; j < sql.length; j++) {
      if (backslash && sql[j] === "\\") j++;
      else if (sql[j] === close) {
        if (sql[j + 1] === close && (close === "'" || close === '"')) j++; // doubled quote = escaped
        else return j + 1;
      }
    }
    return sql.length;
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") i = skipTo(i + 1, "'", d === "MYSQL");
    else if (c === '"') i = skipTo(i + 1, '"', d === "MYSQL");
    else if (c === "`" && d === "MYSQL") i = skipTo(i + 1, "`");
    else if (c === "[" && d === "MSSQL") i = skipTo(i + 1, "]");
    else if (c === "-" && sql[i + 1] === "-") i = skipTo(i + 2, "\n");
    else if (c === "/" && sql[i + 1] === "*") i = sql.indexOf("*/", i + 2) < 0 ? sql.length : sql.indexOf("*/", i + 2) + 2;
    else if (c === ":" && sql[i + 1] === ":") i += 2;
    else if (c === ":" && /[A-Za-z_]/.test(sql[i + 1] ?? "")) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i + 1))!;
      out.push({ start: i, end: i + 1 + m[0].length, name: m[0] });
      i += 1 + m[0].length;
    } else i++;
  }
  return out;
}

/** Distinct :names used by the query, in order. Throws for names we do not provide. */
export function namedParams(d: Dialect, sql: string): NamedParam[] {
  const names = [...new Set(scanNamed(d, sql).map((t) => t.name))];
  const unknown = names.filter((n) => !isNamed(n));
  if (unknown.length) {
    throw new Error(`Parametër i panjohur: ${unknown.map((n) => `:${n}`).join(", ")}. Lejohen ${NAMED_PARAMS.map((n) => `:${n}`).join(", ")}.`);
  }
  return names as NamedParam[];
}

/** Replace :names with the dialect's placeholders ($n reused on Postgres, @pn reused on SQL Server, one ? per use on MySQL). */
export function bindNamed(d: Dialect, sql: string, values: Partial<Record<NamedParam, string>>): Built {
  const tokens = scanNamed(d, sql);
  namedParams(d, sql);
  const params: string[] = [];
  const index = new Map<string, number>();
  let out = "";
  let last = 0;
  for (const t of tokens) {
    const v = values[t.name as NamedParam];
    if (v === undefined) throw new Error(`Mungon vlera për :${t.name}.`);
    let ph: string;
    if (d === "MYSQL") {
      params.push(v);
      ph = "?";
    } else {
      let n = index.get(t.name);
      if (n === undefined) {
        params.push(v);
        n = params.length;
        index.set(t.name, n);
      }
      ph = placeholder(d, n);
    }
    out += sql.slice(last, t.start) + ph;
    last = t.end;
  }
  return { sql: out + sql.slice(last), params };
}

/** One named ERP query, which must use exactly `param` (e.g. a history query without :client_id would list every client). */
export function buildNamed(d: Dialect, query: string, param: NamedParam, value: string, limit: number): Built {
  const q = checkQuery(query);
  const used = namedParams(d, q);
  if (!used.includes(param)) throw new Error(`Query duhet të përdorë parametrin :${param}.`);
  const other = used.filter((n) => n !== param);
  if (other.length) throw new Error(`Ky query lejon vetëm :${param} (u gjet ${other.map((n) => `:${n}`).join(", ")}).`);
  const b = bindNamed(d, q, { [param]: value });
  return { sql: wrap(d, b.sql, "", limit), params: b.params };
}

/** Lookup key for a WhatsApp sender: the last 9 digits of an all-digit id ("...@lid" masked ids are not phones). */
export function phoneKey(externalId: string | null | undefined): string | null {
  const d = externalId?.trim() ?? "";
  if (!/^\d{9,15}$/.test(d)) return null;
  return d.slice(-9);
}

function cell(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
  }
  if (Buffer.isBuffer(v)) return null;
  if (typeof v === "object") return JSON.stringify(v).slice(0, max);
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** ERP row → plain strings for the model (lower-case keys, nulls dropped, bounded size). */
export function textRow(raw: Record<string, unknown>, maxCols = 20, maxLen = 200): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= maxCols) break;
    const s = cell(v, maxLen);
    if (s !== null) out[k.toLowerCase().slice(0, 40)] = s;
  }
  return out;
}

export const CUSTOMER_COLUMNS = ["client_id", "name"] as const;
export const STATUS_COLUMNS = ["status"] as const;

/** Required columns the query did not return (column list from the driver; empty list = unknown, nothing to check). */
export function missingColumns(columns: string[], required: readonly string[]): string[] {
  if (!columns.length) return [];
  const have = new Set(columns.map((c) => c.toLowerCase()));
  return required.filter((c) => !have.has(c));
}
