/**
 * Talk to the assistant from the terminal, without any channel:
 *   npx tsx scripts/ai-chat.ts <org-slug> <customer-external-id> "<message>"
 * Each run = one customer turn on a test conversation (inactive "script" channel, so nothing is ever delivered).
 * The inbound message and the reply are stored, so consecutive runs continue the same chat.
 * Calls the real Claude API (ANTHROPIC_API_KEY). Tools run for real: create_order creates an order and decrements stock.
 * From a Claude Code shell, drop the inherited session vars first (dotenv never overrides existing env):
 *   env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_CUSTOM_HEADERS -u ANTHROPIC_API_KEY -u ANTHROPIC_MODEL \
 *     npx tsx scripts/ai-chat.ts demo-computer-shop test-355690000999 "Përshëndetje"
 */
import "../src/lib/ai/node-shim";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { generateReply, AI_MODEL } from "../src/lib/ai/assistant";

async function main() {
  const [slug, customerExternalId, ...rest] = process.argv.slice(2);
  const text = rest.join(" ").trim();
  if (!slug || !customerExternalId || !text) {
    console.error('usage: npx tsx scripts/ai-chat.ts <org-slug> <customer-external-id> "<message>"');
    process.exit(2);
  }
  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!org) throw new Error(`no organization with slug ${slug}`);

  const channelExternalId = `ai-chat-script:${slug}`;
  const channel =
    (await prisma.channel.findUnique({ where: { type_externalId: { type: "WHATSAPP_OPENWA", externalId: channelExternalId } } })) ??
    (await prisma.channel.create({
      data: {
        organizationId: org.id,
        type: "WHATSAPP_OPENWA",
        externalId: channelExternalId,
        name: "AI chat script (test, never delivers)",
        status: "DISCONNECTED",
        isActive: false,
      },
    }));
  if (channel.organizationId !== org.id) throw new Error("script channel belongs to another org");

  const customer = await prisma.customer.upsert({
    where: { organizationId_externalId: { organizationId: org.id, externalId: customerExternalId } },
    create: { organizationId: org.id, externalId: customerExternalId },
    update: {},
  });
  const conversation = await prisma.conversation.upsert({
    where: { channelId_customerId: { channelId: channel.id, customerId: customer.id } },
    create: { organizationId: org.id, channelId: channel.id, customerId: customer.id },
    update: {},
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      sender: "CUSTOMER",
      text,
      externalId: `script-${randomBytes(6).toString("hex")}`,
    },
  });

  const started = Date.now();
  const reply = await generateReply({ orgId: org.id, conversationId: conversation.id });
  const ms = Date.now() - started;

  if (reply.text) {
    // Stored as SENT so no outbox worker ever tries to deliver it.
    await prisma.message.create({
      data: { conversationId: conversation.id, direction: "OUTBOUND", sender: "AI", text: reply.text, status: "SENT" },
    });
  }
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  console.log(`> ${text}`);
  console.log(`< ${reply.text ?? "(no reply)"}`);
  console.log(
    JSON.stringify(
      { model: AI_MODEL, ms, tools: reply.toolCalls, orderIds: reply.orderIds, handedOff: reply.handedOff, usage: reply.usage },
      null,
      0,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
