// Offline test of the tool loop and the AI-failure path against a local stub of the Messages API (no real API calls).
// Run: npx tsx --test src/lib/ai/*.test.ts
import "./node-shim";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { generateReply } from "@/lib/ai/assistant";
import { handleInbound } from "@/lib/inbound";

const PREFIX = "aistub-test-"; // distinct from pipeline.test.ts (test files run in parallel processes)
const rid = () => randomBytes(8).toString("hex");

type Canned = { status: number; body: unknown };
const queue: Canned[] = [];
const requests: Anthropic.MessageCreateParams[] = [];
let server: http.Server;

const message = (content: unknown[], stop_reason: string, usage = { input_tokens: 100, output_tokens: 20 }) => ({
  status: 200,
  body: {
    id: `msg_${rid()}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 50, ...usage },
  },
});

async function makeShop(label: string) {
  const org = await prisma.organization.create({
    data: {
      id: rid(),
      name: `AI stub ${label}`,
      slug: `${PREFIX}${label}-${rid()}`,
      createdAt: new Date(),
      metadata: JSON.stringify({ aiEnabled: true, currency: "EUR", defaultLanguage: "sq" }),
    },
  });
  const product = await prisma.product.create({
    data: { organizationId: org.id, name: `Lenovo ThinkPad T14 ${label}`, sku: `T14-${label}`, price: "999.99", stock: 4, brand: "Lenovo" },
  });
  const channel = await prisma.channel.create({
    data: { organizationId: org.id, type: "WHATSAPP_OPENWA", name: "stub", externalId: `${PREFIX}${rid()}`, status: "CONNECTED" },
  });
  return { org, product, channel };
}

async function cleanup() {
  const orgs = await prisma.organization.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  if (!ids.length) return;
  await prisma.order.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
}

let A: Awaited<ReturnType<typeof makeShop>>;
let B: Awaited<ReturnType<typeof makeShop>>;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push(JSON.parse(raw));
      const next = queue.shift() ?? { status: 500, body: { type: "error", error: { type: "api_error", message: "stub queue empty" } } };
      res.writeHead(next.status, { "content-type": "application/json" }).end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  // The Anthropic client is created lazily on the first call, so setting env here is enough.
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "stub-key";
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_CUSTOM_HEADERS;

  await cleanup();
  A = await makeShop("a");
  B = await makeShop("b");
});

after(async () => {
  server.close();
  await cleanup();
  await prisma.$disconnect();
});

describe("generateReply tool loop (stubbed API)", () => {
  test("runs tools org-scoped, echoes assistant content, sums usage", async () => {
    const customer = await prisma.customer.create({ data: { organizationId: A.org.id, externalId: `c-${rid()}` } });
    const conv = await prisma.conversation.create({ data: { organizationId: A.org.id, channelId: A.channel.id, customerId: customer.id } });
    await prisma.message.create({ data: { conversationId: conv.id, direction: "INBOUND", sender: "CUSTOMER", text: "A keni Lenovo?" } });

    requests.length = 0;
    const first = [
      { type: "thinking", thinking: "", signature: "sig-abc" },
      { type: "tool_use", id: "toolu_1", name: "search_products", input: { query: "lenovo" } },
    ];
    queue.push(message(first, "tool_use"));
    queue.push(message([{ type: "text", text: "Po, kemi Lenovo ThinkPad T14 me 999.99 EUR." }], "end_turn", { input_tokens: 30, output_tokens: 15 }));

    const reply = await generateReply({ orgId: A.org.id, conversationId: conv.id });
    assert.equal(reply.text, "Po, kemi Lenovo ThinkPad T14 me 999.99 EUR.");
    assert.deepEqual(reply.toolCalls, ["search_products"]);
    assert.equal(reply.handedOff, false);
    assert.deepEqual(reply.usage, { requests: 2, input_tokens: 130, output_tokens: 35, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 });

    assert.equal(requests.length, 2);
    const [r1, r2] = requests;
    assert.equal(r1.tool_choice, undefined); // forced tool_choice is a 400 on claude-opus-5-5
    assert.equal(r1.output_config?.effort, "low");
    assert.deepEqual(r1.cache_control, { type: "ephemeral" });
    assert.ok(Array.isArray(r1.system) && r1.system[0].cache_control);
    assert.ok(r1.tools?.every((t) => "strict" in t && t.strict === true));
    assert.deepEqual(r1.messages, [{ role: "user", content: [{ type: "text", text: "A keni Lenovo?" }] }]);
    assert.deepEqual(JSON.stringify(r1.system), JSON.stringify(r2.system)); // stable prefix for caching

    assert.deepEqual(r2.messages.at(-2), { role: "assistant", content: first }); // incl. thinking block, unchanged
    const last = r2.messages.at(-1)!;
    assert.equal(last.role, "user");
    assert.ok(Array.isArray(last.content));
    const result = last.content[0] as Anthropic.ToolResultBlockParam;
    assert.equal(result.type, "tool_result");
    assert.equal(result.tool_use_id, "toolu_1");
    assert.ok(String(result.content).includes(A.product.id));
    assert.ok(!String(result.content).includes(B.product.id));
  });

  test("refusal is an error, never sent as a reply", async () => {
    const customer = await prisma.customer.create({ data: { organizationId: A.org.id, externalId: `c-${rid()}` } });
    const conv = await prisma.conversation.create({ data: { organizationId: A.org.id, channelId: A.channel.id, customerId: customer.id } });
    await prisma.message.create({ data: { conversationId: conv.id, direction: "INBOUND", sender: "CUSTOMER", text: "..." } });
    queue.push(message([], "refusal"));
    await assert.rejects(generateReply({ orgId: A.org.id, conversationId: conv.id }), /refused/);
  });

  test("a conversation of another org is not found", async () => {
    const customer = await prisma.customer.create({ data: { organizationId: B.org.id, externalId: `c-${rid()}` } });
    const conv = await prisma.conversation.create({ data: { organizationId: B.org.id, channelId: B.channel.id, customerId: customer.id } });
    await assert.rejects(generateReply({ orgId: A.org.id, conversationId: conv.id }), /not found/);
  });
});

describe("handleInbound AI failure", () => {
  test("API error → conversation switched to HUMAN, HUMAN_NEEDED notification, nothing sent", async () => {
    queue.length = 0;
    queue.push({ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } });
    const ext = `3556${rid().slice(0, 8)}`;
    await handleInbound({
      channelType: "WHATSAPP_OPENWA",
      channelExternalId: A.channel.externalId,
      customerExternalId: ext,
      messageId: `wamid-${rid()}`,
      text: "Përshëndetje",
    });
    const conv = await prisma.conversation.findFirstOrThrow({ where: { organizationId: A.org.id, customer: { externalId: ext } } });
    assert.equal(conv.mode, "HUMAN");
    const n = await prisma.notification.findMany({ where: { organizationId: A.org.id, type: "HUMAN_NEEDED" } });
    assert.equal(n.length, 1);
    assert.equal(n[0].link, `/conversations/${conv.id}`);
    assert.equal(await prisma.message.count({ where: { conversationId: conv.id, direction: "OUTBOUND" } }), 0);
  });
});
