import "server-only";
import { Prisma, type InventoryDialect } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { buildBySku, buildSample, buildSearch, normalizeRow, type Built, type InventoryRow } from "@/lib/inventory/sql";

// Live, read-only reads from a shop's own DB. Rows are mirrored into Product by (organizationId, sku) so the AI keeps
// using our Product ids (OrderItem FK, cached tool text) — but search results are restricted to rows read live.
// Read-only guarantee = the DB user's grants (ask the shop for a SELECT-only user). READ ONLY transactions on
// Postgres/MySQL are defence in depth; MSSQL has no equivalent.

const TIMEOUT_MS = 5_000;
const LIVE_LIMIT = 60;

type Result = { rows: Record<string, unknown>[]; columns: string[] };

// shortcut: one connection per query (fine for chat volume); add a small pool per source if it gets busy.
async function run(dialect: InventoryDialect, url: string, q: Built): Promise<Result> {
  if (dialect === "POSTGRES") {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: url, connectionTimeoutMillis: TIMEOUT_MS, statement_timeout: TIMEOUT_MS, query_timeout: TIMEOUT_MS + 1000 });
    await c.connect();
    try {
      await c.query("BEGIN TRANSACTION READ ONLY");
      const r = await c.query(q.sql, q.params);
      return { rows: r.rows, columns: r.fields.map((f) => f.name) };
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
      const [rows, fields] = await c.query({ sql: q.sql, timeout: TIMEOUT_MS }, q.params);
      return { rows: rows as Record<string, unknown>[], columns: (fields ?? []).map((f) => f.name) };
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      await c.end().catch(() => {});
    }
  }
  const mssql = (await import("mssql")).default;
  const pool = await new mssql.ConnectionPool(url).connect();
  try {
    const req = pool.request();
    q.params.forEach((p, i) => req.input(`p${i + 1}`, mssql.NVarChar, p));
    const r = await req.query(q.sql);
    return { rows: r.recordset ?? [], columns: Object.keys(r.recordset?.columns ?? {}) };
  } finally {
    await pool.close().catch(() => {});
  }
}

/** Run with a hard timeout (drivers' own timeouts do not cover every hang, e.g. DNS). */
async function query(dialect: InventoryDialect, url: string, q: Built): Promise<Result> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("Inventory DB did not answer in time")), TIMEOUT_MS * 2);
  });
  try {
    return await Promise.race([run(dialect, url, q), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

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
 * Live search. Returns null when the shop has no external source (use our catalogue as before), otherwise the
 * Product ids of the rows read live. Throws InventoryUnavailable when their DB fails.
 */
export async function liveSearch(orgId: string, terms: string[]): Promise<string[] | null> {
  const src = await activeSource(orgId);
  if (!src) return null;
  const q = buildSearch(src.dialect, src.query, src.columns, terms, LIVE_LIMIT);
  if (!q) return [];
  try {
    const r = await query(src.dialect, decrypt(src.url), q);
    return await mirror(orgId, r.rows.map(normalizeRow).filter((x): x is InventoryRow => x !== null));
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
