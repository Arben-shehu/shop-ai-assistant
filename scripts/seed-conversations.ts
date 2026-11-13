import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type { MessageSender } from "../src/generated/prisma/client";

// Demo inbox data for org "demo-computer-shop". Idempotent: keyed on unique columns, safe to run twice.
// Run: npx tsx scripts/seed-conversations.ts

const ORG_SLUG = "demo-computer-shop";
const OPERATOR_EMAIL = "agent@techstore.al";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

type SeedMessage = {
  from: MessageSender;
  text?: string;
  mediaUrl?: string;
  /** minutes before now */
  at: number;
  error?: string;
};

type SeedConversation = {
  customer: { externalId: string; name: string; phone: string; address?: string };
  mode: "AI" | "HUMAN" | "CLOSED";
  assignOperator?: boolean;
  unreadCount: number;
  messages: SeedMessage[];
};

const conversations: SeedConversation[] = [
  {
    customer: { externalId: "355691234567", name: "Arta Krasniqi", phone: "+355 69 123 4567", address: "Rruga e Durrësit 45, Tiranë" },
    mode: "AI",
    unreadCount: 0,
    messages: [
      { from: "CUSTOMER", at: 95, text: "Përshëndetje! Kërkoj një laptop për universitet, buxheti deri në 800€." },
      { from: "AI", at: 94, text: "Përshëndetje Arta! Për studime ju rekomandoj HP ProBook 450 G10 (Intel i5, 16GB RAM, 512GB SSD) me 749.99€, ose Lenovo ThinkPad E14 Gen 5 me 649.99€. Të dy kanë garanci 2-vjeçare. Cilin preferoni?" },
      { from: "CUSTOMER", at: 80, text: "HP-ja më pëlqen. A e keni në stok?" },
      { from: "AI", at: 79, text: "Po, HP ProBook 450 G10 është në stok. Dëshironi ta porosisni? Më duhet vetëm adresa e dorëzimit." },
      { from: "CUSTOMER", at: 70, text: "Po, Rruga e Durrësit 45, Tiranë." },
      { from: "AI", at: 69, text: "Faleminderit! Porosia juaj u regjistrua: HP ProBook 450 G10 × 1, totali 749.99€. Pagesa bëhet në dorëzim. Do t'ju kontaktojmë për orarin e dërgesës." },
      { from: "CUSTOMER", at: 12, text: "Faleminderit shumë! Kur mund të vijë afërsisht?" },
      { from: "AI", at: 11, text: "Dërgesat në Tiranë zakonisht mbërrijnë brenda 24 orëve. Do të merrni një telefonatë nga korrieri para dorëzimit." },
    ],
  },
  {
    customer: { externalId: "355682345678", name: "Bledi Hoxha", phone: "+355 68 234 5678", address: "Lagjja 18 Shtatori, Durrës" },
    mode: "HUMAN",
    assignOperator: true,
    unreadCount: 2,
    messages: [
      { from: "CUSTOMER", at: 240, text: "Mirëdita, bleva një Lenovo Legion 5 Pro para dy javësh dhe ekrani ka filluar të dridhet." },
      { from: "AI", at: 239, text: "Më vjen keq për problemin, Bledi. Pajisja është në garanci. Po ju lidh me një operator që do t'ju ndihmojë me procedurën e garancisë." },
      { from: "OPERATOR", at: 225, text: "Përshëndetje Bledi, ju shkruan ekipi i dyqanit. A mund të na dërgoni një foto ose video të ekranit?" },
      { from: "OPERATOR", at: 224, text: "Gjithashtu na dërgoni numrin e faturës, ju lutem.", error: "Gateway-i OpenWA nuk u përgjigj (timeout 30s)" },
      { from: "CUSTOMER", at: 6, mediaUrl: "https://picsum.photos/seed/legion-screen/640/420", text: "Ja si duket ekrani" },
      { from: "CUSTOMER", at: 5, text: "Fatura është nr. 2024-1187. A mund ta sjell në dyqan sot?" },
    ],
  },
  {
    customer: { externalId: "355673456789", name: "Elona Berisha", phone: "+355 67 345 6789" },
    mode: "AI",
    unreadCount: 0,
    messages: [
      { from: "CUSTOMER", at: 150, text: "A keni laptop gaming me RTX 4060?" },
      { from: "AI", at: 149, text: "Po! Kemi HP Victus 16 Gaming (Intel i7, RTX 4060, 16GB RAM) me 1099.99€ dhe Lenovo Legion 5 Pro (Ryzen 7, RTX 4060) me 1399.99€." },
      { from: "CUSTOMER", at: 140, text: "Sa kushton dërgesa për në Shkodër?" },
      { from: "AI", at: 139, text: "Dërgesa jashtë Tiranës kushton 300 lekë dhe mbërrin brenda 1–2 ditëve pune." },
    ],
  },
  {
    customer: { externalId: "355694567890", name: "Gent Shala", phone: "+355 69 456 7890", address: "Rruga Kavajës 120, Tiranë" },
    mode: "CLOSED",
    unreadCount: 0,
    messages: [
      { from: "CUSTOMER", at: 1560, text: "Përshëndetje, a keni mouse pa kabllo Logitech?" },
      { from: "AI", at: 1559, text: "Përshëndetje Gent! Po, kemi disa modele Logitech. Mund të kaloni në dyqan në Rrugën e Kavajës ose t'jua dërgojmë në shtëpi." },
      { from: "CUSTOMER", at: 1500, text: "Do kaloj vetë nesër. Faleminderit!" },
      { from: "OPERATOR", at: 1490, text: "Ju presim! Jemi të hapur 09:00–20:00. Ditë të mbarë!" },
    ],
  },
];

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization "${ORG_SLUG}" not found. Run the main seed first.`);
  const operator = await prisma.user.findUnique({ where: { email: OPERATOR_EMAIL } });

  const channel =
    (await prisma.channel.findFirst({ where: { organizationId: org.id, type: "WHATSAPP_OPENWA", externalId: "demo-session" } })) ??
    (await prisma.channel.create({
      data: {
        organizationId: org.id,
        type: "WHATSAPP_OPENWA",
        name: "Demo (pa lidhje)",
        externalId: "demo-session",
        // Fake session for demo data: inactive so the health monitor and outbox leave it alone.
        status: "DISCONNECTED",
        isActive: false,
      },
    }));

  const conversationIds: Record<string, string> = {};

  for (const [ci, c] of conversations.entries()) {
    const customer = await prisma.customer.upsert({
      where: { organizationId_externalId: { organizationId: org.id, externalId: c.customer.externalId } },
      update: {},
      create: { organizationId: org.id, ...c.customer },
    });

    const first = Math.max(...c.messages.map((m) => m.at));
    const last = Math.min(...c.messages.map((m) => m.at));
    const conversation = await prisma.conversation.upsert({
      where: { channelId_customerId: { channelId: channel.id, customerId: customer.id } },
      update: {},
      create: {
        organizationId: org.id,
        channelId: channel.id,
        customerId: customer.id,
        mode: c.mode,
        assigneeId: c.assignOperator ? (operator?.id ?? null) : null,
        unreadCount: c.unreadCount,
        lastMessageAt: minutesAgo(last),
        createdAt: minutesAgo(first),
      },
    });
    conversationIds[customer.externalId] = conversation.id;

    for (const [mi, m] of c.messages.entries()) {
      const externalId = `seed-c${ci + 1}-m${mi + 1}`;
      const inbound = m.from === "CUSTOMER";
      await prisma.message.upsert({
        where: { conversationId_externalId: { conversationId: conversation.id, externalId } },
        update: {},
        create: {
          conversationId: conversation.id,
          externalId,
          direction: inbound ? "INBOUND" : "OUTBOUND",
          sender: m.from,
          operatorId: m.from === "OPERATOR" ? (operator?.id ?? null) : null,
          text: m.text ?? null,
          mediaUrl: m.mediaUrl ?? null,
          mediaType: m.mediaUrl ? "image/jpeg" : null,
          status: inbound ? "RECEIVED" : m.error ? "FAILED" : "SENT",
          attempts: inbound ? 0 : m.error ? 3 : 1,
          error: m.error ?? null,
          createdAt: minutesAgo(m.at),
        },
      });
    }
  }

  // One order placed through Arta's conversation.
  const orderConversationId = conversationIds["355691234567"];
  const hasOrder = await prisma.order.findFirst({ where: { organizationId: org.id, conversationId: orderConversationId } });
  if (!hasOrder) {
    const product = await prisma.product.findFirst({ where: { organizationId: org.id, sku: "LAP-HP-PB450-G10-I5" } });
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: orderConversationId } });
    const unitPrice = product?.price ?? "749.99";
    await prisma.order.create({
      data: {
        organizationId: org.id,
        customerId: conv.customerId,
        conversationId: orderConversationId,
        status: "CONFIRMED",
        total: unitPrice,
        deliveryAddress: "Rruga e Durrësit 45, Tiranë",
        notes: "Pagesa në dorëzim",
        createdAt: minutesAgo(69),
        items: { create: [{ productId: product?.id ?? null, name: product?.name ?? "HP ProBook 450 G10", quantity: 1, unitPrice }] },
      },
    });
  }

  console.log(`Seeded ${conversations.length} conversations on channel "${channel.name}" for org "${org.name}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
