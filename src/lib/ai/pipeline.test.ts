// Run: npx tsx --test src/lib/ai/*.test.ts   (uses the real dev DB; creates and deletes its own throwaway orgs)
import "./node-shim";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrder } from "@/lib/orders";
import { runTool, type ToolContext } from "@/lib/ai/tools";
import { buildHistory, type HistoryRow } from "@/lib/ai/history";
import { searchTermGroups } from "@/lib/ai/search-terms";
import { handleInbound } from "@/lib/inbound";

const PREFIX = "ai-test-";
const rid = () => randomBytes(8).toString("hex");

type Fixture = Awaited<ReturnType<typeof makeShop>>;
let A: Fixture;
let B: Fixture;

async function makeShop(label: string) {
  const org = await prisma.organization.create({
    data: {
      id: rid(),
      name: `AI test ${label}`,
      slug: `${PREFIX}${label}-${rid()}`,
      createdAt: new Date(),
      metadata: JSON.stringify({ aiEnabled: false, currency: "EUR" }), // never calls Claude from tests
    },
  });
  const mk = (name: string, sku: string, price: string, stock: number, extra: Record<string, string> = {}) =>
    prisma.product.create({ data: { organizationId: org.id, name, sku, price, stock, ...extra } });
  const thinkpad = await mk(`Lenovo ThinkPad T14 ${label}`, `T14-${label}`, "999.99", 5, {
    category: "Laptop",
    brand: "Lenovo",
    description: "Intel i5, 16GB RAM, 256GB SSD",
  });
  const mouse = await mk(`Logitech Mouse ${label}`, `MOUSE-${label}`, "19.90", 1, { category: "Accessories", brand: "Logitech" });
  const cable = await mk(`USB-C Cable ${label}`, `CABLE-${label}`, "0.10", 50, { category: "Accessories" });
  const headset = await mk(`HyperX Cloud Headset ${label}`, `HS-${label}`, "79.00", 3, { category: "Headset", brand: "HyperX" });
  const hidden = await mk(`Lenovo Legion Hidden ${label}`, `HID-${label}`, "1.00", 9, { brand: "Lenovo" });
  await prisma.product.update({ where: { id: hidden.id }, data: { isActive: false } });
  const customer = await prisma.customer.create({
    data: { organizationId: org.id, externalId: `3556${rid().slice(0, 8)}`, name: `Test ${label}` },
  });
  const channel = await prisma.channel.create({
    data: { organizationId: org.id, type: "WHATSAPP_OPENWA", name: "test", externalId: `${PREFIX}${rid()}`, status: "CONNECTED" },
  });
  const conversation = await prisma.conversation.create({
    data: { organizationId: org.id, channelId: channel.id, customerId: customer.id },
  });
  return { org, thinkpad, mouse, cable, headset, hidden, customer, channel, conversation };
}

function ctxFor(s: Fixture, customerId = s.customer.id): ToolContext {
  return {
    orgId: s.org.id,
    conversationId: s.conversation.id,
    customerId,
    currency: "EUR",
    state: { handedOff: false, orderIds: [] },
  };
}

async function cleanup() {
  const orgs = await prisma.organization.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  if (!ids.length) return;
  await prisma.order.deleteMany({ where: { organizationId: { in: ids } } }); // Order.customer is onDelete: Restrict
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
}

const stockOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stock;
const searchIds = async (s: Fixture, input: Record<string, unknown>) => {
  const out = await runTool("search_products", input, ctxFor(s));
  assert.equal(out.isError, false, out.content);
  return (JSON.parse(out.content).results as { id: string }[]).map((r) => r.id);
};

before(async () => {
  await cleanup(); // leftovers from an aborted run
  A = await makeShop("a");
  B = await makeShop("b");
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("search_products", () => {
  test("is scoped to the conversation's shop", async () => {
    const ids = await searchIds(A, { query: "lenovo thinkpad" });
    assert.deepEqual(ids, [A.thinkpad.id]);
    for (const q of ["lenovo", "T14-b", "thinkpad b", "mouse", ""]) {
      const found = await searchIds(A, { query: q, limit: 10 });
      for (const p of [B.thinkpad, B.mouse, B.cable, B.headset, B.hidden]) assert.ok(!found.includes(p.id), `"${q}" leaked ${p.name}`);
    }
  });

  test("never returns inactive products", async () => {
    const ids = await searchIds(A, { query: "legion" });
    assert.ok(!ids.includes(A.hidden.id));
  });

  test("matches Albanian terms, plurals and specs", async () => {
    assert.deepEqual(await searchIds(A, { query: "A keni laptop Lenovo me 16 GB RAM?" }), [A.thinkpad.id]);
    assert.deepEqual(await searchIds(A, { query: "laptopë" }), [A.thinkpad.id]);
    assert.deepEqual(await searchIds(A, { query: "kufje" }), [A.headset.id]);
    assert.deepEqual(await searchIds(A, { query: "maus logitech" }), [A.mouse.id]);
    assert.ok(searchTermGroups("Përshëndetje, a keni?").length === 0);
  });

  test("falls back to partial matches and filters by price", async () => {
    const res = JSON.parse((await runTool("search_products", { query: "lenovo macbook" }, ctxFor(A))).content);
    assert.equal(res.matchType, "partial");
    assert.ok(res.results.some((r: { id: string }) => r.id === A.thinkpad.id));
    assert.deepEqual(await searchIds(A, { query: "lenovo", maxPrice: 500 }), []);
    const none = JSON.parse((await runTool("search_products", { query: "printer" }, ctxFor(A))).content);
    assert.equal(none.matchType, "none");
    assert.ok(none.shopCategories.includes("Laptop"));
  });

  test("rejects invalid input instead of running", async () => {
    const out = await runTool("search_products", { query: 42 }, ctxFor(A));
    assert.equal(out.isError, true);
    const big = await runTool("search_products", { query: "a", limit: 1000 }, ctxFor(A));
    assert.equal(big.isError, false); // limit is clamped, not trusted
  });

  test("get_product refuses another shop's product", async () => {
    const out = await runTool("get_product", { productId: B.thinkpad.id }, ctxFor(A));
    assert.equal(out.isError, true);
    assert.ok(!out.content.includes(B.thinkpad.name));
  });
});

describe("createOrder", () => {
  test("rejects a product from another shop and touches no stock", async () => {
    const before = await stockOf(B.thinkpad.id);
    const r = await createOrder(A.org.id, { customerId: A.customer.id, items: [{ productId: B.thinkpad.id, quantity: 1 }] });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.code, "PRODUCT_NOT_FOUND");
    assert.equal(await stockOf(B.thinkpad.id), before);
    assert.equal(await prisma.order.count({ where: { organizationId: A.org.id, customerId: A.customer.id, items: { some: { productId: B.thinkpad.id } } } }), 0);
  });

  test("rejects a customer from another shop", async () => {
    const r = await createOrder(A.org.id, { customerId: B.customer.id, items: [{ productId: A.cable.id, quantity: 1 }] });
    assert.equal(!r.ok && r.error.code, "CUSTOMER_NOT_FOUND");
  });

  test("rejects bad quantities", async () => {
    for (const quantity of [0, -1, 1.5, 101]) {
      const r = await createOrder(A.org.id, { customerId: A.customer.id, items: [{ productId: A.cable.id, quantity }] });
      assert.equal(!r.ok && r.error.code, "INVALID_INPUT", `quantity ${quantity}`);
    }
  });

  test("concurrent orders for the last unit: exactly one succeeds", async () => {
    assert.equal(await stockOf(A.mouse.id), 1);
    // Different customers: the same customer repeating an order is refused earlier as DUPLICATE (see below).
    const buyers = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => prisma.customer.create({ data: { organizationId: A.org.id, externalId: `race-${i}-${rid()}`, name: `R${i}` } })),
    );
    const results = await Promise.all(
      buyers.map((b) => createOrder(A.org.id, { customerId: b.id, items: [{ productId: A.mouse.id, quantity: 1 }] })),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.error.code === "OUT_OF_STOCK"));
    const failed = results.find((r) => !r.ok);
    assert.ok(failed && !failed.ok);
    assert.equal(failed.error.code === "OUT_OF_STOCK" && failed.error.items[0].available, 0);
    assert.equal(await stockOf(A.mouse.id), 0);
  });

  test("computes totals with Decimal, snapshots items and decrements stock", async () => {
    const r = await createOrder(A.org.id, {
      customerId: A.customer.id,
      conversationId: A.conversation.id,
      items: [
        { productId: A.thinkpad.id, quantity: 2 },
        { productId: A.cable.id, quantity: 3 },
        { productId: A.cable.id, quantity: 0 + 1 }, // duplicate line is merged
      ],
      deliveryAddress: "Rruga e Durrësit 10, Tiranë",
    });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.order.total, "2000.38"); // 2 x 999.99 + 4 x 0.10 (float math would give 2000.3799999999999)
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id }, include: { items: true } });
    assert.equal(saved.organizationId, A.org.id);
    assert.equal(saved.conversationId, A.conversation.id);
    assert.equal(saved.total.toFixed(2), "2000.38");
    assert.equal(saved.items.length, 2);
    const cableLine = saved.items.find((i) => i.productId === A.cable.id)!;
    assert.equal(cableLine.quantity, 4);
    assert.equal(cableLine.unitPrice.toFixed(2), "0.10");
    assert.equal(cableLine.name, A.cable.name);
    assert.equal(await stockOf(A.thinkpad.id), 3);
    assert.equal(await stockOf(A.cable.id), 46);
    assert.equal(await prisma.notification.count({ where: { organizationId: A.org.id, type: "NEW_ORDER" } }) >= 1, true);
  });

  test("multi-item order rolls back fully when one item is short", async () => {
    const before = await stockOf(A.cable.id);
    const r = await createOrder(A.org.id, {
      customerId: A.customer.id,
      items: [
        { productId: A.cable.id, quantity: 1 },
        { productId: A.headset.id, quantity: 4 }, // only 3 in stock
      ],
    });
    assert.equal(!r.ok && r.error.code, "OUT_OF_STOCK");
    assert.equal(await stockOf(A.cable.id), before);
    assert.equal(await stockOf(A.headset.id), 3);
  });
});

describe("createOrder dedupe", () => {
  test("same customer, same lines within 30 min: DUPLICATE with the first order's number; other qty: new order", async () => {
    const c = await prisma.customer.create({ data: { organizationId: A.org.id, externalId: `dup-${rid()}`, name: "Dup" } });
    const items = [
      { productId: A.cable.id, quantity: 2 },
      { productId: A.thinkpad.id, quantity: 1 },
    ];
    const first = await createOrder(A.org.id, { customerId: c.id, items });
    assert.ok(first.ok, JSON.stringify(first));
    const stock = await stockOf(A.cable.id);
    const second = await createOrder(A.org.id, { customerId: c.id, items: [...items].reverse() }); // line order does not matter
    assert.equal(!second.ok && second.error.code, "DUPLICATE");
    assert.equal(!second.ok && second.error.code === "DUPLICATE" && second.error.number, first.order.number);
    assert.equal(await stockOf(A.cable.id), stock, "a duplicate touches no stock");
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } });
    assert.match(saved.itemsHash ?? "", /^[0-9a-f]{64}$/);

    const other = await createOrder(A.org.id, { customerId: c.id, items: [{ productId: A.cable.id, quantity: 3 }, items[1]] });
    assert.ok(other.ok, JSON.stringify(other));

    // A cancelled order does not block re-ordering the same lines.
    await prisma.order.update({ where: { id: first.order.id }, data: { status: "CANCELLED" } });
    const again = await createOrder(A.org.id, { customerId: c.id, items });
    assert.ok(again.ok, JSON.stringify(again));
  });

  test("two concurrent identical confirmations create one order", async () => {
    const c = await prisma.customer.create({ data: { organizationId: A.org.id, externalId: `dupc-${rid()}`, name: "Dup C" } });
    const run = () => createOrder(A.org.id, { customerId: c.id, items: [{ productId: A.cable.id, quantity: 1 }] });
    const results = await Promise.all([run(), run()]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.error.code === "DUPLICATE").length, 1);
    assert.equal(await prisma.order.count({ where: { customerId: c.id } }), 1);
  });

  test("create_order tool returns the existing reference instead of an error", async () => {
    const c = await prisma.customer.create({ data: { organizationId: A.org.id, externalId: `dupt-${rid()}`, name: "Dup T" } });
    const input = { items: [{ productId: A.cable.id, quantity: 5 }] };
    const first = JSON.parse((await runTool("create_order", input, ctxFor(A, c.id))).content);
    assert.equal(first.created, true);
    assert.equal(first.reference, `AI-${first.orderNumber}`);
    const out = await runTool("create_order", input, ctxFor(A, c.id)); // next reply, fresh state
    assert.equal(out.isError, false);
    const again = JSON.parse(out.content);
    assert.equal(again.alreadyPlaced, true);
    assert.equal(again.reference, first.reference);
  });
});

describe("create_order tool", () => {
  test("requires a known customer name and creates at most one order per reply", async () => {
    const anon = await prisma.customer.create({ data: { organizationId: A.org.id, externalId: `anon-${rid()}` } });
    const anonCtx = ctxFor(A, anon.id);
    const noName = await runTool("create_order", { items: [{ productId: A.cable.id, quantity: 1 }] }, anonCtx);
    assert.equal(noName.isError, true);
    assert.match(noName.content, /name/);

    const saved = await runTool("save_customer_details", { name: "Ardit Hoxha" }, anonCtx);
    assert.equal(saved.isError, false);
    const first = await runTool("create_order", { items: [{ productId: A.cable.id, quantity: 1 }] }, anonCtx);
    assert.equal(first.isError, false, first.content);
    assert.equal(JSON.parse(first.content).total, "0.10 EUR");
    const again = await runTool("create_order", { items: [{ productId: A.cable.id, quantity: 1 }] }, anonCtx);
    assert.equal(again.isError, true);

    const foreign = await runTool("create_order", { items: [{ productId: B.cable.id, quantity: 1 }] }, ctxFor(A));
    assert.equal(foreign.isError, true);
    assert.match(foreign.content, /PRODUCT_NOT_FOUND/);
  });

  test("get_order_status only sees the customer's own orders", async () => {
    const other = await runTool("get_order_status", {}, ctxFor(B));
    assert.deepEqual(JSON.parse(other.content).orders, []);
  });
});

describe("buildHistory", () => {
  let t = Date.parse("2026-01-01T10:00:00Z");
  const row = (direction: "INBOUND" | "OUTBOUND", text: string, extra: Partial<HistoryRow> = {}): HistoryRow => ({
    id: text,
    direction,
    sender: direction === "INBOUND" ? "CUSTOMER" : "AI",
    status: direction === "INBOUND" ? "RECEIVED" : "SENT",
    text,
    mediaUrl: null,
    mediaType: null,
    createdAt: new Date((t += 1000)),
    ...extra,
  });
  const roles = (h: ReturnType<typeof buildHistory>) => h.messages.map((m) => m.role).join(",");

  test("starts with user, merges consecutive roles, ends with the unanswered messages", () => {
    const rows = [row("OUTBOUND", "promo"), row("INBOUND", "hi"), row("INBOUND", "anyone?"), row("OUTBOUND", "hello"), row("INBOUND", "laptop?")];
    const h = buildHistory(rows);
    assert.equal(roles(h), "user,assistant,user");
    assert.deepEqual(h.answeredIds, ["laptop?"]);
  });

  test("nothing to answer when the last row is a reply", () => {
    assert.equal(buildHistory([row("INBOUND", "q"), row("OUTBOUND", "a")]).messages.length, 0);
  });

  test("a message that arrived during generation is moved after the reply", () => {
    const rows = [row("INBOUND", "q1"), row("INBOUND", "q2"), row("OUTBOUND", "a1")];
    const h = buildHistory(rows, { answerIds: ["q2"] });
    assert.equal(roles(h), "user,assistant,user");
    assert.deepEqual(h.answeredIds, ["q2"]);
  });

  test("skips FAILED outbound rows and only sends the newest image as an image block", () => {
    const rows = [
      row("INBOUND", "old", { mediaUrl: "https://cdn.example/old.jpg", mediaType: "image/jpeg" }),
      row("OUTBOUND", "lost", { status: "FAILED" }),
      row("OUTBOUND", "seen"),
      row("INBOUND", "this one", { mediaUrl: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png" }),
    ];
    const h = buildHistory(rows);
    const json = JSON.stringify(h.messages);
    assert.ok(!json.includes("lost"));
    assert.ok(!json.includes("old.jpg"));
    assert.ok(h.hasImages);
    const last = h.messages.at(-1)!;
    assert.ok(Array.isArray(last.content) && last.content[0].type === "image");
    assert.equal(buildHistory(rows, { images: false }).hasImages, false);
  });
});

describe("handleInbound (AI disabled for test orgs)", () => {
  test("saves once, drops duplicates and unknown channels, never throws", async () => {
    const msg = {
      channelType: "WHATSAPP_OPENWA" as const,
      channelExternalId: A.channel.externalId,
      customerExternalId: "355690000001",
      customerName: "Blerta",
      messageId: `wamid-${rid()}`,
      text: "Përshëndetje",
    };
    await handleInbound(msg);
    await handleInbound(msg); // duplicate webhook delivery
    await handleInbound({ ...msg, channelExternalId: "does-not-exist", messageId: "x" });
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { organizationId_externalId: { organizationId: A.org.id, externalId: "355690000001" } },
    });
    assert.equal(customer.name, "Blerta");
    assert.equal(customer.phone, "355690000001");
    const conv = await prisma.conversation.findFirstOrThrow({ where: { organizationId: A.org.id, customerId: customer.id } });
    assert.equal(conv.unreadCount, 1);
    assert.equal(await prisma.message.count({ where: { conversationId: conv.id } }), 1);
    assert.equal(await prisma.customer.count({ where: { organizationId: B.org.id, externalId: "355690000001" } }), 0);

    await prisma.conversation.update({ where: { id: conv.id }, data: { mode: "CLOSED" } });
    await handleInbound({ ...msg, messageId: `wamid-${rid()}`, text: "prapë unë" });
    const reopened = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    assert.equal(reopened.mode, "AI");
    assert.equal(reopened.unreadCount, 2);
  });
});
