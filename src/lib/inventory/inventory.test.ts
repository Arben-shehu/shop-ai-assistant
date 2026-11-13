// Run: npx tsx --test src/lib/inventory/inventory.test.ts
// Integration part needs INV_TEST_URL = a SELECT-only Postgres user on a DB with a `products` table (old app's DB).
import "@/lib/ai/node-shim";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { buildBySku, buildSearch, checkQuery, normalizeRow } from "@/lib/inventory/sql";

const COLS = ["sku", "name", "price", "stock", "brand"];

describe("sql builder", () => {
  test("wraps the admin query and binds terms (escaped) per dialect", () => {
    const pg = buildSearch("POSTGRES", "SELECT a AS sku FROM t;", COLS, ["50%_off", "lenovo"], 60)!;
    assert.match(pg.sql, /^SELECT \* FROM \(SELECT a AS sku FROM t\) AS inv WHERE .* LIMIT 60$/);
    assert.match(pg.sql, /CAST\("name" AS TEXT\) ILIKE \$1 ESCAPE '!'/);
    assert.deepEqual(pg.params, ["%50!%!_off%", "%lenovo%"]);
    const my = buildSearch("MYSQL", "SELECT 1", COLS, ["x"], 5)!;
    assert.equal(my.params.length, 3); // one "?" per searchable column (name, sku, brand)
    assert.ok(my.sql.includes("CAST(`sku` AS CHAR) LIKE ?"));
    const ms = buildSearch("MSSQL", "SELECT 1", COLS, ["x"], 5)!;
    assert.match(ms.sql, /^SELECT TOP \(5\) \* FROM \(SELECT 1\) AS inv WHERE CAST\(\[name\] AS NVARCHAR\(MAX\)\) LIKE @p1/);
    assert.equal(buildSearch("POSTGRES", "SELECT 1", COLS, [" "], 5), null);
    assert.match(buildBySku("POSTGRES", "SELECT 1", COLS, ["a", "b"]).sql, /IN \(\$1, \$2\) LIMIT 2$/);
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
