import "server-only";
import { Prisma, type InventoryDialect } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import {
  buildBySku,
  buildNamed,
  buildSample,
  buildSearch,
  normalizeRow,
  textRow,
  type Built,
  type Dialect,
  type InventoryRow,
  type NamedParam,
} from "@/lib/inventory/sql";

// Live, read-only reads from a shop's own DB. Rows are mirrored into Product by (organizationId, sku) so the AI keeps
// using our Product ids (OrderItem FK, cached tool text) — but search results are restricted to rows read live.
// Read-only guarantee = the DB user's grants (ask the shop for a SELECT-only user). READ ONLY transactions on
// Postgres/MySQL are defence in depth; MSSQL has no equivalent.

const TIMEOUT_MS = 5_000;
const LIVE_LIMIT = 60;

type Result = { rows: Record<string, unknown>[]; columns: string[] };

// shortcut: one connection per call (fine for chat volume); add a small pool per source if it gets busy.
// Several queries in one call share the connection (the status sync reads up to 50 refs at once).
async function run(dialect: InventoryDialect, url: string, qs: Built[]): Promise<Result[]> {
  const out: Result[] = [];
  if (dialect === "POSTGRES") {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: url, connectionTimeoutMillis: TIMEOUT_MS, statement_timeout: TIMEOUT_MS, query_timeout: TIMEOUT_MS + 1000 });
    await c.connect();
    try {
      await c.query("BEGIN TRANSACTION READ ONLY");
      for (const q of qs) {
        const r = await c.query(q.sql, q.params);
        out.push({ rows: r.rows, columns: r.fields.map((f) => f.name) });
      }
      return out;
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      await c.end().catch(() => {});
    }
  }
  if (dialect === "MYSQL") {
    const mysql = await import("mysql2/promise");
    const c = await mysql.createConnection({ uri: url, connectTimeout: TIMEOUT_MS });
    try {
      await c.query("START TRANSACTION READ ONLY");
      for (const q of qs) {
        const [rows, fields] = await c.query({ sql: q.sql, timeout: TIMEOUT_MS }, q.params);
        out.push({ rows: rows as Record<string, unknown>[], columns: (fields ?? []).map((f) => f.name) });
      }
      return out;
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      await c.end().catch(() => {});
    }
  }
  const mssql = (await import("mssql")).default;
  const pool = await new mssql.ConnectionPool(url).connect();
  try {
    for (const q of qs) {
      const req = pool.request();
      q.params.forEach((p, i) => req.input(`p${i + 1}`, mssql.NVarChar, p));
      const r = await req.query(q.sql);
      out.push({ rows: r.recordset ?? [], columns: Object.keys(r.recordset?.columns ?? {}) });
    }
    return out;
  } finally {
    await pool.close().catch(() => {});
  }
}

/** Run with a hard timeout (drivers' own timeouts do not cover every hang, e.g. DNS). */
async function queryAll(dialect: InventoryDialect, url: string, qs: Built[]): Promise<Result[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("Inventory DB did not answer in time")), TIMEOUT_MS * (1 + qs.length));
  });
  try {
    return await Promise.race([run(dialect, url, qs), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const query = async (dialect: InventoryDialect, url: string, q: Built) => (await queryAll(dialect, url, [q]))[0];

export async function testSource(dialect: InventoryDialect, url: string, sql: string) {
  const r = await query(dialect, url, buildSample(dialect, sql, 5));
  const rows = r.rows.map(normalizeRow);
  return { columns: r.columns, sample: rows.filter((x): x is InventoryRow => x !== null), skipped: rows.filter((x) => x === null).length };
}

const activeSource = (orgId: string) =>
  prisma.inventorySource.findFirst({ where: { organizationId: orgId, isActive: true } });

export async function hasInventorySource(orgId: string) {
  return (await prisma.inventorySource.count({ where: { organizationId: orgId, isActive: true } })) > 0;
}

async function mirror(orgId: string, rows: InventoryRow[]): Promise<string[]> {
  const bySku = new Map(rows.map((r) => [r.sku, r])); // duplicate SKUs: last row wins
  const ops = [...bySku.values()].map((r) => {
    const data = {
      name: r.name,
      price: new Prisma.Decimal(r.price),
      stock: r.stock,
      category: r.category,
      brand: r.brand,
      description: r.description,
      imageUrl: r.imageUrl,
      attributes: r.attributes ?? Prisma.DbNull,
      isActive: true,
    };
    return prisma.product.upsert({
      where: { organizationId_sku: { organizationId: orgId, sku: r.sku } },
      create: { organizationId: orgId, sku: r.sku, ...data },
      update: data,
      select: { id: true },
    });
  });
  return (await prisma.$transaction(ops)).map((p) => p.id);
}

async function recordError(id: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[inventory] live read failed", msg);
  await prisma.inventorySource.update({ where: { id }, data: { lastError: msg.slice(0, 500), lastCheckedAt: new Date() } }).catch(() => {});
}

export class InventoryUnavailable extends Error {}

/**
 * Live search: rows matching every group (query words + category/brand filters), falling back to rows matching any
 * variant when none match all. Returns null when the shop has no external source (use our catalogue as before), otherwise the
 * Product ids of the rows read live. Throws InventoryUnavailable when their DB fails.
 */
export async function liveSearch(orgId: string, groups: string[][], filters: string[][] = []): Promise<string[] | null> {
  const src = await activeSource(orgId);
  if (!src) return null;
  const all = [...groups, ...filters];
  const q = buildSearch(src.dialect, src.query, src.columns, all, LIVE_LIMIT, "all");
  if (!q) return [];
  try {
    const url = decrypt(src.url);
    let rows = (await query(src.dialect, url, q)).rows;
    // Nothing has every word: read rows matching any word so the caller can offer ranked partial matches.
    if (!rows.length && all.length > 1) {
      rows = (await query(src.dialect, url, buildSearch(src.dialect, src.query, src.columns, all, LIVE_LIMIT, "any")!)).rows;
    }
    return await mirror(orgId, rows.map(normalizeRow).filter((x): x is InventoryRow => x !== null));
  } catch (e) {
    await recordError(src.id, e);
    throw new InventoryUnavailable();
  }
}

/** Re-read these products live (before showing details / ordering). Products gone from their DB are deactivated. */
export async function refreshProducts(orgId: string, productIds: string[]): Promise<void> {
  const src = await activeSource(orgId);
  if (!src || !productIds.length) return;
  const known = await prisma.product.findMany({ where: { id: { in: productIds }, organizationId: orgId }, select: { sku: true } });
  const skus = known.map((p) => p.sku);
  if (!skus.length) return;
  try {
    const r = await query(src.dialect, decrypt(src.url), buildBySku(src.dialect, src.query, src.columns, skus));
    const rows = r.rows.map(normalizeRow).filter((x): x is InventoryRow => x !== null);
    await mirror(orgId, rows);
    const found = new Set(rows.map((x) => x.sku));
    const gone = skus.filter((s) => !found.has(s));
    if (gone.length) await prisma.product.updateMany({ where: { organizationId: orgId, sku: { in: gone } }, data: { isActive: false } });
  } catch (e) {
    await recordError(src.id, e);
    throw new InventoryUnavailable();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// ERP reads (customer / history / order status). Same connection rules, same InventoryUnavailable on failure.
// ---------------------------------------------------------------------------------------------------------------

const CUSTOMER_ROWS = 20;
export const HISTORY_ROWS = 20;

/** Settings page: run one named query with a sample value. Throws the driver/validation error. */
export async function testNamedQuery(dialect: Dialect, url: string, sql: string, param: NamedParam, value: string) {
  const r = await query(dialect, url, buildNamed(dialect, sql, param, value, 5));
  return { columns: r.columns, rows: r.rows.length };
}

export type ErpLookup =
  | { status: "none" }
  | { status: "many"; count: number }
  | { status: "one"; clientId: string; client: Record<string, string>; history: Record<string, string>[] | null };

export async function erpSource(orgId: string) {
  const src = await activeSource(orgId);
  return src?.customerQuery ? src : null;
}

/**
 * Identify a client by phone key (last 9 digits of the WhatsApp sender) and, when exactly one client matches, read
 * that client's history with the client_id from this same lookup. Throws InventoryUnavailable when their DB fails.
 */
export async function lookupErpClient(orgId: string, phone: string): Promise<ErpLookup | null> {
  const src = await erpSource(orgId);
  if (!src?.customerQuery) return null;
  try {
    const url = decrypt(src.url);
    const r = await query(src.dialect, url, buildNamed(src.dialect, src.customerQuery, "phone", phone, CUSTOMER_ROWS));
    const rows = r.rows.map((x) => textRow(x, 30, 200));
    const ids = [...new Set(rows.map((x) => x.client_id).filter(Boolean))];
    if (ids.length === 0) return { status: "none" };
    if (ids.length > 1) return { status: "many", count: ids.length };
    const clientId = ids[0];
    const client = rows.find((x) => x.client_id === clientId)!;
    let history: Record<string, string>[] | null = null;
    if (src.historyQuery) {
      const h = await query(src.dialect, url, buildNamed(src.dialect, src.historyQuery, "client_id", clientId, HISTORY_ROWS));
      history = h.rows.slice(0, HISTORY_ROWS).map((x) => textRow(x, 15, 300));
    }
    return { status: "one", clientId, client, history };
  } catch (e) {
    await recordError(src.id, e);
    throw new InventoryUnavailable();
  }
}

/** Read our refs (AI-<number>) back from their DB. Returns the first row per ref (lower-case keys) or null. */
export async function readOrderStatuses(
  src: { id: string; dialect: Dialect; url: string; orderStatusQuery: string },
  refs: string[],
): Promise<Map<string, Record<string, unknown> | null>> {
  const qs = refs.map((ref) => buildNamed(src.dialect, src.orderStatusQuery, "ref", ref, 1));
  const res = await queryAll(src.dialect, decrypt(src.url), qs);
  return new Map(
    refs.map((ref, i) => {
      const row = res[i].rows[0];
      return [ref, row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])) : null];
    }),
  );
}

export { recordError as recordSourceError };
