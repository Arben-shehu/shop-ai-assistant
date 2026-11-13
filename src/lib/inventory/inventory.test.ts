// Run: npx tsx --test src/lib/inventory/inventory.test.ts
// Integration parts:
//  - INV_TEST_URL = a SELECT-only Postgres user on a DB with a `products` table (old app's DB).
//  - PHARMA_TEST_URL = the pharma_reader user on the DB built by scripts/pharma-test-db.sql. The status-sync test also
//    writes porosi_hyrese through DATABASE_URL's user on that DB (PHARMA_ADMIN_URL overrides).
import "@/lib/ai/node-shim";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  bindNamed,
  buildBySku,
  buildNamed,
  buildSearch,
  checkQuery,
  missingColumns,
  namedParams,
  normalizeRow,
  phoneKey,
  textRow,
} from "@/lib/inventory/sql";
import { searchTermGroups } from "@/lib/ai/search-terms";

const COLS = ["sku", "name", "price", "stock", "brand"];

describe("sql builder", () => {
  test("wraps the admin query and binds terms (escaped) per dialect", () => {
    const pg = buildSearch("POSTGRES", "SELECT a AS sku FROM t;", COLS, [["50%_off"], ["lenovo"]], 60)!;
    assert.match(pg.sql, /^SELECT \* FROM \(SELECT a AS sku FROM t\) AS inv WHERE .* ORDER BY "name" LIMIT 60$/);
    assert.match(pg.sql, /CAST\("name" AS TEXT\) ILIKE \$1 ESCAPE '!'/);
    assert.deepEqual(pg.params, ["%50!%!_off%", "%lenovo%"]);
    const my = buildSearch("MYSQL", "SELECT 1", COLS, [["x"]], 5)!;
    assert.equal(my.params.length, 3); // one "?" per searchable column (name, sku, brand)
    assert.ok(my.sql.includes("CAST(`sku` AS CHAR) LIKE ?"));
    const ms = buildSearch("MSSQL", "SELECT 1", COLS, [["x"]], 5)!;
    assert.match(ms.sql, /^SELECT TOP \(5\) \* FROM \(SELECT 1\) AS inv WHERE \(CAST\(\[name\] AS NVARCHAR\(MAX\)\) LIKE @p1/);
    assert.match(ms.sql, /ORDER BY \[name\]$/);
    assert.equal(buildSearch("POSTGRES", "SELECT 1", COLS, [[" "]], 5), null);
    assert.equal(buildSearch("POSTGRES", "SELECT 1", COLS, [], 5), null);
    assert.match(buildBySku("POSTGRES", "SELECT 1", COLS, ["a", "b"]).sql, /IN \(\$1, \$2\) LIMIT 2$/);
  });
  test("AND across term groups, OR inside a group; OR-of-everything only in 'any' mode", () => {
    const groups = searchTermGroups("paracetamol 500 mg");
    assert.deepEqual(groups, [["paracetamol"], ["500mg", "500 mg"]]);
    const all = buildSearch("POSTGRES", "SELECT 1", ["sku", "name", "price", "stock"], groups, 60)!;
    const where = all.sql.slice(all.sql.indexOf(" WHERE ") + 7, all.sql.indexOf(" ORDER BY"));
    // (paracetamol in name OR sku) AND (500mg in name OR sku OR "500 mg" in name OR sku)
    assert.equal(where.split(") AND (").length, 2);
    assert.match(where, /^\(CAST\("name" AS TEXT\) ILIKE \$1 ESCAPE '!' OR CAST\("sku" AS TEXT\) ILIKE \$1 ESCAPE '!'\) AND \(.*\$2.* OR .*\$3.*\)$/);
    assert.deepEqual(all.params, ["%paracetamol%", "%500mg%", "%500 mg%"]);
    const any = buildSearch("POSTGRES", "SELECT 1", ["sku", "name", "price", "stock"], groups, 60, "any")!;
    assert.ok(!any.sql.includes(" AND "));
    assert.equal(any.params.length, 3);
    // MySQL: one positional "?" per column per variant, in order.
    const my = buildSearch("MYSQL", "SELECT 1", ["sku", "name", "price", "stock"], [["a", "b"], ["c"]], 10)!;
    assert.deepEqual(my.params, ["%a%", "%a%", "%b%", "%b%", "%c%", "%c%"]);
    assert.equal(my.sql.split("?").length - 1, 6);
    // Filters (category/brand) are their own groups; a group is never cut, empty groups are dropped.
    const f = buildSearch("POSTGRES", "SELECT 1", COLS, [["dell"], [], ["laptop", "notebook"]], 10)!;
    assert.equal(f.params.length, 3);
  });
  test("named params: dialect placeholders, reuse, casts, literals and comments are not params", () => {
    const sql = "SELECT id AS client_id FROM k WHERE a = :phone OR b = :phone AND c::text = '10:30' -- :ref\n AND d = :client_id::int /* :x */";
    assert.deepEqual(namedParams("POSTGRES", sql), ["phone", "client_id"]);
    const pg = bindNamed("POSTGRES", sql, { phone: "691234567", client_id: "7" });
    assert.equal(pg.sql, "SELECT id AS client_id FROM k WHERE a = $1 OR b = $1 AND c::text = '10:30' -- :ref\n AND d = $2::int /* :x */");
    assert.deepEqual(pg.params, ["691234567", "7"]);
    const my = bindNamed("MYSQL", "SELECT 1 FROM t WHERE a = :phone OR b = :phone OR c = 'it''s :ref' OR `:col` = 1", { phone: "9" });
    assert.equal(my.sql, "SELECT 1 FROM t WHERE a = ? OR b = ? OR c = 'it''s :ref' OR `:col` = 1");
    assert.deepEqual(my.params, ["9", "9"]);
    const ms = bindNamed("MSSQL", "SELECT 1 FROM t WHERE [x:y] = :ref OR z = :ref", { ref: "AI-1" });
    assert.equal(ms.sql, "SELECT 1 FROM t WHERE [x:y] = @p1 OR z = @p1");
    assert.deepEqual(ms.params, ["AI-1"]);
    assert.throws(() => namedParams("POSTGRES", "SELECT 1 WHERE a = :evil"), /:evil/);
    assert.throws(() => bindNamed("POSTGRES", "SELECT 1 WHERE a = :ref", {}), /:ref/);
  });
  test("a named query must use exactly its own parameter and is capped", () => {
    const b = buildNamed("POSTGRES", "SELECT * FROM faturat WHERE klient_id = :client_id ORDER BY data DESC LIMIT 50", "client_id", "3", 20);
    assert.equal(b.sql, "SELECT * FROM (SELECT * FROM faturat WHERE klient_id = $1 ORDER BY data DESC LIMIT 50) AS inv LIMIT 20");
    assert.deepEqual(b.params, ["3"]);
    assert.match(buildNamed("MSSQL", "SELECT TOP 50 * FROM f WHERE k = :client_id ORDER BY d DESC", "client_id", "3", 20).sql, /^SELECT TOP \(20\) \* FROM/);
    assert.throws(() => buildNamed("POSTGRES", "SELECT * FROM faturat", "client_id", "3", 20), /:client_id/); // would list every client
    assert.throws(() => buildNamed("POSTGRES", "SELECT * FROM k WHERE tel = :phone AND id = :client_id", "phone", "1", 5), /vetëm :phone/);
    assert.throws(() => buildNamed("POSTGRES", "SELECT 1 WHERE x = :phone; DELETE FROM k", "phone", "1", 5));
  });
  test("phone key = last 9 digits of an all-digit WhatsApp id", () => {
    assert.equal(phoneKey("355691234567"), "691234567");
    assert.equal(phoneKey("39333123456"), "333123456");
    assert.equal(phoneKey("1234567@lid"), null);
    assert.equal(phoneKey("12345678"), null);
    assert.equal(phoneKey("web:abc"), null);
    assert.equal(phoneKey(null), null);
  });
  test("ERP rows become bounded strings", () => {
    assert.deepEqual(textRow({ ID: 7, Emri: " Farmacia X ", data: new Date("2026-01-02T00:00:00Z"), bosh: null, borxhi: "12.50" }), {
      id: "7", emri: "Farmacia X", data: "2026-01-02", borxhi: "12.50",
    });
    assert.equal(textRow({ a: "x".repeat(500) }, 5, 10).a.length, 10);
    assert.deepEqual(missingColumns(["CLIENT_ID", "emri"], ["client_id", "name"]), ["name"]);
    assert.deepEqual(missingColumns([], ["status"]), []);
  });
  test("only a single SELECT is accepted", () => {
    assert.throws(() => checkQuery("DELETE FROM products"));
    assert.throws(() => checkQuery("SELECT 1; DROP TABLE products"));
    assert.throws(() => checkQuery("WITH x AS (SELECT 1) SELECT * FROM x"));
    assert.equal(checkQuery("  select 1 ;"), "select 1");
  });
  test("normalizes driver rows", () => {
    assert.deepEqual(normalizeRow({ SKU: " A1 ", Name: "Mouse", PRICE: "19,9", stock: null, ram: "16GB", warranty: true }), {
      sku: "A1", name: "Mouse", price: "19.90", stock: 0, category: null, brand: null, description: null, imageUrl: null,
      attributes: { ram: "16GB", warranty: true },
    });
    assert.equal(normalizeRow({ sku: "A", name: "", price: 1, stock: 1 }), null);
    assert.equal(normalizeRow({ sku: "A", name: "x", price: "abc", stock: 1 }), null);
    assert.equal(normalizeRow({ sku: "A", name: "x", price: 1, stock: 2.7 })!.stock, 2);
  });
});

const URL = process.env.INV_TEST_URL;
const QUERY = "SELECT sku, name, price, stock, category, brand, description, cpu, ram FROM products";
const PREFIX = "invtest-";

describe("live source (Postgres)", { skip: !URL && "INV_TEST_URL not set" }, async () => {
  const { prisma } = await import("@/lib/prisma");
  const { encrypt } = await import("@/lib/crypto");
  const { testSource } = await import("@/lib/inventory/source");
  const { runTool } = await import("@/lib/ai/tools");
  const rid = () => randomBytes(6).toString("hex");

  async function shop(url: string) {
    const org = await prisma.organization.create({
      data: { id: rid(), name: "inv test", slug: `${PREFIX}${rid()}`, createdAt: new Date(), metadata: JSON.stringify({ aiEnabled: false }) },
    });
    const { columns } = await testSource("POSTGRES", URL!, QUERY);
    await prisma.inventorySource.create({ data: { organizationId: org.id, dialect: "POSTGRES", url: encrypt(url), query: QUERY, columns } });
    const stale = await prisma.product.create({ data: { organizationId: org.id, name: "Lenovo Ghost", sku: `GONE-${rid()}`, price: "1", stock: 9 } });
    const customer = await prisma.customer.create({ data: { organizationId: org.id, externalId: `web:${rid()}`, name: "Ana" } });
    const channel = await prisma.channel.create({ data: { organizationId: org.id, type: "WEB", name: "web", externalId: `${PREFIX}${rid()}`, status: "CONNECTED" } });
    const conversation = await prisma.conversation.create({ data: { organizationId: org.id, channelId: channel.id, customerId: customer.id } });
    const ctx = { orgId: org.id, conversationId: conversation.id, customerId: customer.id, currency: "EUR", state: { handedOff: false, orderIds: [] as string[] } };
    return { org, stale, customer, ctx };
  }

  after(async () => {
    const ids = (await prisma.organization.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } })).map((o) => o.id);
    await prisma.order.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  test("test query returns the required columns", async () => {
    const r = await testSource("POSTGRES", URL!, QUERY);
    for (const c of ["sku", "name", "price", "stock"]) assert.ok(r.columns.includes(c));
    assert.ok(r.sample.length > 0);
  });

  test("writes are rejected through our code path", async () => {
    await assert.rejects(testSource("POSTGRES", URL!, "SELECT nextval('products_id_seq')::text AS sku, 'x' AS name, 1 AS price, 1 AS stock"));
  });

  test("search is strictly live; get_product and create_order re-read live", async () => {
    const s = await shop(URL!);
    const res = JSON.parse((await runTool("search_products", { query: "lenovo" }, s.ctx)).content);
    assert.equal(res.matchType, "all_terms");
    assert.ok(res.results.length > 0);
    assert.ok(!res.results.some((p: { name: string }) => p.name === "Lenovo Ghost"), "mirror-only row must not be returned");
    const id = res.results.find((p: { inStock: boolean }) => p.inStock).id;

    const detail = await runTool("get_product", { productId: id }, s.ctx);
    assert.equal(detail.isError, false);
    assert.equal((await runTool("get_product", { productId: s.stale.id }, s.ctx)).isError, true); // gone from their DB

    const noPhone = await runTool("create_order", { items: [{ productId: id, quantity: 1 }] }, s.ctx);
    assert.match(noPhone.content, /phone number/);
    await prisma.customer.update({ where: { id: s.customer.id }, data: { phone: "+355691234567" } });
    const order = JSON.parse((await runTool("create_order", { items: [{ productId: id, quantity: 1 }] }, s.ctx)).content);
    assert.equal(order.created, true);
  });

  test("their DB down: tool error for the model, no throw", async () => {
    const s = await shop("postgresql://nobody:x@127.0.0.1:1/nothing");
    const out = await runTool("search_products", { query: "lenovo" }, s.ctx);
    assert.equal(out.isError, true);
    assert.match(out.content, /INVENTORY_UNAVAILABLE/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Pharma warehouse ERP (scripts/pharma-test-db.sql): customer identity by WhatsApp number, history, live search over
// 1500 products, order dedupe through the tool, status read-back.
// ---------------------------------------------------------------------------------------------------------------------

const PHARMA_URL = process.env.PHARMA_TEST_URL;
// The same 4 queries as in the comments at the top of scripts/pharma-test-db.sql.
const PHARMA = {
  query:
    "SELECT kodi AS sku, emertimi AS name, cmimi AS price, sasia AS stock, kategoria AS category, prodhuesi AS brand, " +
    "principi_aktiv || ' ' || doza || ' ' || forma AS description, principi_aktiv, forma, doza, skadenca FROM artikujt WHERE aktiv",
  customerQuery:
    "SELECT id AS client_id, emri AS name, nipt, adresa || ', ' || qyteti AS address, qyteti, borxhi, limiti_kredise " +
    "FROM klientet WHERE aktiv AND right(regexp_replace(tel, '[^0-9]', '', 'g'), 9) = :phone",
  historyQuery:
    "SELECT f.nr AS fatura, f.data AS data, f.totali AS totali, f.statusi AS statusi, " +
    "(SELECT string_agg(r.sasia || ' x ' || a.emertimi, ' | ' ORDER BY r.id) FROM fatura_rreshtat r JOIN artikujt a ON a.kodi = r.artikull_kodi " +
    "WHERE r.fatura_id = f.id) AS artikujt FROM faturat f WHERE f.klient_id = :client_id::int ORDER BY f.data DESC LIMIT 20",
  orderStatusQuery:
    "SELECT ref, statusi AS external_status, CASE lower(statusi) WHEN 'ne pritje' THEN 'PENDING' WHEN 'konfirmuar' THEN 'CONFIRMED' " +
    "WHEN 'ne pergatitje' THEN 'PREPARING' WHEN 'dorezuar' THEN 'DELIVERED' WHEN 'anuluar' THEN 'CANCELLED' END AS status " +
    "FROM porosi_hyrese WHERE ref = :ref",
};

function pharmaAdminUrl() {
  if (process.env.PHARMA_ADMIN_URL) return process.env.PHARMA_ADMIN_URL;
  const u = new globalThis.URL(process.env.DATABASE_URL!);
  u.pathname = "/pharma_test";
  return u.toString();
}

describe("pharma ERP (Postgres)", { skip: !PHARMA_URL && "PHARMA_TEST_URL not set" }, async () => {
  const { prisma } = await import("@/lib/prisma");
  const { encrypt } = await import("@/lib/crypto");
  const { testSource, testNamedQuery } = await import("@/lib/inventory/source");
  const { syncOrgOrderStatuses } = await import("@/lib/inventory/status-sync");
  const { runTool } = await import("@/lib/ai/tools");
  const { Client } = await import("pg");
  const rid = () => randomBytes(6).toString("hex");
  const insertedRefs: string[] = [];

  async function sql<T = Record<string, unknown>>(url: string, text: string, params: unknown[] = []): Promise<T[]> {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      return (await c.query(text, params)).rows as T[];
    } finally {
      await c.end();
    }
  }

  async function pharmaShop(url = PHARMA_URL!) {
    const org = await prisma.organization.create({
      data: { id: rid(), name: "pharma test", slug: `${PREFIX}pharma-${rid()}`, createdAt: new Date(), metadata: JSON.stringify({ aiEnabled: false, currency: "ALL" }) },
    });
    const { columns } = await testSource("POSTGRES", PHARMA_URL!, PHARMA.query);
    await prisma.inventorySource.create({
      data: { organizationId: org.id, dialect: "POSTGRES", url: encrypt(url), columns, ...PHARMA },
    });
    const channel = (type: "WHATSAPP_OPENWA" | "WEB") =>
      prisma.channel.create({ data: { organizationId: org.id, type, name: type, externalId: `${PREFIX}${rid()}`, status: "CONNECTED", isActive: false } });
    const wa = await channel("WHATSAPP_OPENWA");
    const web = await channel("WEB");
    /** A conversation of a customer writing from `externalId` on WhatsApp (or the web widget). */
    async function chat(externalId: string, via: "wa" | "web" = "wa", data: { name?: string; phone?: string } = {}) {
      const customer = await prisma.customer.create({ data: { organizationId: org.id, externalId, ...data } });
      const conversation = await prisma.conversation.create({ data: { organizationId: org.id, channelId: (via === "wa" ? wa : web).id, customerId: customer.id } });
      const ctx = () => ({ orgId: org.id, conversationId: conversation.id, customerId: customer.id, currency: "ALL", state: { handedOff: false, orderIds: [] as string[] } });
      return { customer, ctx };
    }
    return { org, chat };
  }

  const call = async (name: string, input: unknown, ctx: Parameters<typeof runTool>[2]) => {
    const out = await runTool(name, input, ctx);
    assert.equal(out.isError, false, out.content);
    return JSON.parse(out.content);
  };

  after(async () => {
    if (insertedRefs.length) await sql(pharmaAdminUrl(), "DELETE FROM porosi_hyrese WHERE ref = ANY($1)", [insertedRefs]);
    const ids = (await prisma.organization.findMany({ where: { slug: { startsWith: `${PREFIX}pharma-` } }, select: { id: true } })).map((o) => o.id);
    await prisma.order.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  test("the four admin queries pass the settings checks with their sample values", async () => {
    const c = await testNamedQuery("POSTGRES", PHARMA_URL!, PHARMA.customerQuery, "phone", "000000000");
    assert.deepEqual(missingColumns(c.columns, ["client_id", "name"]), []);
    assert.equal(c.rows, 0);
    await testNamedQuery("POSTGRES", PHARMA_URL!, PHARMA.historyQuery, "client_id", "0");
    const s = await testNamedQuery("POSTGRES", PHARMA_URL!, PHARMA.orderStatusQuery, "ref", "AI-0");
    assert.deepEqual(missingColumns(s.columns, ["status"]), []);
  });

  test("each messy phone format identifies its pharmacy; profile, history, externalRef and name are filled", async () => {
    const shop = await pharmaShop();
    const clients = await sql<{ id: number; emri: string; tel: string }>(PHARMA_URL!, "SELECT id, emri, tel FROM klientet WHERE id BETWEEN 1 AND 6 ORDER BY id");
    assert.equal(new Set(clients.map((c) => c.tel.replace(/\d/g, "9"))).size, 6, "six different formats");
    for (const c of clients) {
      const { customer, ctx } = await shop.chat(`35569000100${c.id}`);
      const out = await call("get_customer", {}, ctx());
      assert.equal(out.identified, true, `${c.tel}: ${JSON.stringify(out)}`);
      assert.equal(out.erpClient.client_id, String(c.id));
      assert.equal(out.erpClient.name, c.emri);
      assert.ok(out.erpClient.nipt && out.erpClient.borxhi !== undefined);
      assert.equal(out.erpHistory.length, 8);
      assert.equal(out.name, c.emri, "empty name filled from the ERP");
      const saved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      assert.equal(saved.externalRef, String(c.id));
      assert.ok(saved.address?.includes(","));
    }
  });

  test("a phone shared by two pharmacies, an unknown phone and a closed account are not identified", async () => {
    const shop = await pharmaShop();
    const shared = await call("get_customer", {}, (await shop.chat("355690009999")).ctx());
    assert.equal(shared.identified, false);
    assert.equal(shared.erpClient, undefined);
    assert.equal(shared.erpHistory, undefined);
    assert.match(shared.note, /more than one client[\s\S]*handoff_to_human/);
    for (const id of ["355690001099", "355690001037", "1234567890@lid"]) {
      const out = await call("get_customer", {}, (await shop.chat(id)).ctx());
      assert.equal(out.identified, false, id);
      assert.equal(out.erpClient, undefined, id);
    }
  });

  test("pharmacy A never gets pharmacy B's data, even after the model saves B's phone", async () => {
    const shop = await pharmaShop();
    const { ctx } = await shop.chat("355690001001", "wa", { name: "Ana" });
    await call("save_customer_details", { phone: "+355 69 000 1002" }, ctx()); // B's number
    const out = await call("get_customer", {}, ctx());
    assert.equal(out.erpClient.client_id, "1");
    assert.equal(out.name, "Ana", "an existing name is kept");
    const mine = new Set((await sql<{ nr: string }>(PHARMA_URL!, "SELECT nr FROM faturat WHERE klient_id = 1")).map((r) => r.nr));
    const theirs = new Set((await sql<{ nr: string }>(PHARMA_URL!, "SELECT nr FROM faturat WHERE klient_id = 2")).map((r) => r.nr));
    const got = (out.erpHistory as { fatura: string }[]).map((h) => h.fatura);
    assert.equal(got.length, mine.size);
    assert.ok(got.every((nr) => mine.has(nr) && !theirs.has(nr)));
    assert.ok(!JSON.stringify(out).includes("Farmacia Shpresa"));
  });

  test("web widget visitors are anonymous: catalogue only, pointed to WhatsApp", async () => {
    const shop = await pharmaShop();
    const { customer, ctx } = await shop.chat(`web:${rid()}`, "web", { phone: "0690001001" });
    const out = await call("get_customer", {}, ctx());
    assert.equal(out.identified, false);
    assert.equal(out.anonymous, true);
    assert.equal(out.erpClient, undefined);
    assert.match(out.note, /WhatsApp/);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).externalRef, null);
    const search = await call("search_products", { query: "ibuprofen 400mg" }, ctx());
    assert.ok(search.results.length > 0, "the catalogue still works");
  });

  test("AND search finds 'paracetamol 500mg' among 1500 products (250 contain 500mg)", async () => {
    const shop = await pharmaShop();
    const { ctx } = await shop.chat("355690001001");
    for (const query of ["paracetamol 500mg", "500 mg paracetamol"]) {
      const out = await call("search_products", { query, limit: 10 }, ctx());
      assert.equal(out.matchType, "all_terms", query);
      assert.ok(out.results.length >= 5, query);
      for (const r of out.results) assert.match(r.name, /^Paracetamol 500mg/, `${query}: ${r.name}`);
    }
    // No row has every word: the OR fallback still returns ranked alternatives.
    const partial = await call("search_products", { query: "paracetamol 850mg" }, ctx());
    assert.equal(partial.matchType, "partial");
    assert.ok(partial.results.length > 0);
  });

  test("create_order for an unnamed WhatsApp client takes the ERP name, returns AI-<n>, and is not placed twice", async () => {
    const shop = await pharmaShop();
    const { customer, ctx } = await shop.chat("355690001004"); // no name, never called get_customer
    const found = await call("search_products", { query: "amoxicillin 500mg" }, ctx());
    const item = found.results.find((r: { inStock: boolean }) => r.inStock);
    const order = await call("create_order", { items: [{ productId: item.id, quantity: 2 }] }, ctx());
    assert.equal(order.created, true);
    assert.equal(order.reference, `AI-${order.orderNumber}`);
    const saved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(saved.name, "Farmacia Lulishtja");
    assert.equal(saved.externalRef, "4");
    const again = await call("create_order", { items: [{ productId: item.id, quantity: 2 }] }, ctx());
    assert.equal(again.alreadyPlaced, true);
    assert.equal(again.reference, order.reference);
    assert.equal(await prisma.order.count({ where: { customerId: customer.id } }), 1);
  });

  test("status sync applies the ERP status by AI-<n>, records their wording, leaves unknown refs alone", async () => {
    const shop = await pharmaShop();
    const { ctx } = await shop.chat("355690001005");
    const found = await call("search_products", { query: "ibuprofen 400mg" }, ctx());
    const ids = found.results.filter((r: { inStock: boolean }) => r.inStock).map((r: { id: string }) => r.id);
    const o1 = await call("create_order", { items: [{ productId: ids[0], quantity: 1 }] }, ctx());
    const o2 = await call("create_order", { items: [{ productId: ids[0], quantity: 3 }] }, ctx());
    insertedRefs.push(o1.reference);
    await sql(pharmaAdminUrl(), "INSERT INTO porosi_hyrese (ref, klient_id, statusi) VALUES ($1, 5, 'konfirmuar')", [o1.reference]);

    const r1 = await syncOrgOrderStatuses(shop.org.id);
    assert.deepEqual(r1, { checked: 2, updated: 1, failed: false });
    const a = await prisma.order.findFirstOrThrow({ where: { number: o1.orderNumber } });
    assert.equal(a.status, "CONFIRMED");
    assert.equal(a.externalStatus, "konfirmuar");
    assert.ok(a.syncedAt);
    const b = await prisma.order.findFirstOrThrow({ where: { number: o2.orderNumber } });
    assert.equal(b.status, "PENDING");
    assert.equal(b.externalStatus, null);
    assert.ok(b.syncedAt, "not found: only syncedAt");
    const log = await prisma.activityLog.findFirst({ where: { organizationId: shop.org.id, action: "order.status_changed", entityId: a.id } });
    assert.equal((log?.meta as { by?: string; to?: string })?.by, "erp");

    // The ERP may jump straight to delivered.
    await sql(pharmaAdminUrl(), "UPDATE porosi_hyrese SET statusi = 'dorezuar' WHERE ref = $1", [o1.reference]);
    await syncOrgOrderStatuses(shop.org.id);
    assert.equal((await prisma.order.findFirstOrThrow({ where: { number: o1.orderNumber } })).status, "DELIVERED");
    const status = await call("get_order_status", { orderNumber: o1.orderNumber }, ctx());
    assert.equal(status.orders[0].status, "DELIVERED");
    assert.equal(status.orders[0].reference, o1.reference);
  });

  test("their DB down: get_customer answers INVENTORY_UNAVAILABLE, the sync records the error and carries on", async () => {
    const shop = await pharmaShop("postgresql://nobody:x@127.0.0.1:1/nothing");
    const { ctx } = await shop.chat("355690001001");
    const out = await runTool("get_customer", {}, ctx());
    assert.equal(out.isError, true);
    assert.match(out.content, /INVENTORY_UNAVAILABLE/);
    await prisma.order.create({ data: { organizationId: shop.org.id, customerId: (await shop.chat("355690001002")).customer.id, total: "1" } });
    assert.deepEqual(await syncOrgOrderStatuses(shop.org.id), { checked: 0, updated: 0, failed: true });
    assert.ok((await prisma.inventorySource.findFirstOrThrow({ where: { organizationId: shop.org.id } })).lastError);
  });
});
