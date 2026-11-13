import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { publish } from "@/lib/events";
import { logActivity } from "@/lib/activity";
import { createOrder, MAX_LINE_QUANTITY, MAX_ORDER_LINES } from "@/lib/orders";
import { searchTermGroups, termVariants } from "@/lib/ai/search-terms";

/**
 * Everything a tool may touch comes from here — never from model input. The model can only name products
 * (verified against orgId) and pass free text; customer/conversation/org are fixed by the conversation.
 */
export type ToolContext = {
  orgId: string;
  conversationId: string;
  customerId: string;
  currency: string;
  /** Mutated by executors so the caller can see what happened during the turn. */
  state: { handedOff: boolean; orderIds: string[] };
};

export type ToolOutcome = { content: string; isError: boolean };

const SEARCH_LIMIT_MAX = 10;
const SEARCHABLE = ["name", "sku", "brand", "category", "description"] as const;

// ---------------------------------------------------------------------------------------------------------------
// Definitions. Order and text must stay byte-stable (they are part of the cached prompt prefix).
// Strict schemas: no min/max/length keywords (unsupported) — bounds are enforced by the zod schemas below.
// ---------------------------------------------------------------------------------------------------------------

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "Search this shop's catalogue. Call it whenever the customer asks about a product, brand, category, spec, price or availability, " +
      "when they send a photo of a product/box (search for the brand/model you read on it), and again right before create_order to get " +
      "the current productId. Pass the key words (any language; Albanian and English terms are both matched), e.g. 'lenovo 16gb'. " +
      "Returns up to 10 active products with id, name, price, stock and key specs. matchType 'partial' means no product matched every " +
      "word — present them as alternatives, not as exact matches.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Key words: brand, model, product type, specs. Leave out filler words." },
        category: { type: "string", description: "Optional category filter, e.g. 'Laptop', 'Monitor'." },
        brand: { type: "string", description: "Optional brand filter, e.g. 'Lenovo'." },
        maxPrice: { type: "number", description: "Optional maximum unit price in the shop currency." },
        limit: { type: "integer", description: "Max results, 1-10 (default 5)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_product",
    description:
      "Get full details of one product (all specs, description, current price and stock) by its productId from search_products. " +
      "Call it when the customer asks for more details about a specific product.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { productId: { type: "string", description: "id returned by search_products." } },
      required: ["productId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_customer",
    description:
      "Get what the shop knows about the customer in this chat: name, phone, delivery address and their last orders. " +
      "Call it before taking an order (to know whether you must ask for their name/address) and when they ask about past orders.",
    strict: true,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "save_customer_details",
    description:
      "Save the customer's name, phone and/or delivery address once they tell you. Call it as soon as a new customer gives their " +
      "name while ordering, or when they give/change their address or phone. Only pass the fields they actually provided.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full name as the customer wrote it." },
        phone: { type: "string", description: "Phone number." },
        address: { type: "string", description: "Delivery address (street, city)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_order",
    description:
      "Place the order. Call it ONLY after (1) the customer's name is known (get_customer / save_customer_details), (2) you showed " +
      "them every item with quantity, unit price and the total, and (3) they explicitly confirmed (e.g. 'po', 'yes', 'konfirmoj'). " +
      "Use productIds from a search_products/get_product call made in this turn. Call it once per confirmed order. If it returns " +
      "OUT_OF_STOCK, tell the customer what is available and offer alternatives. Tell the customer the order number and the total it returns.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "One entry per product.",
          items: {
            type: "object",
            properties: {
              productId: { type: "string", description: "id from search_products." },
              quantity: { type: "integer", description: "Units, at least 1." },
            },
            required: ["productId", "quantity"],
            additionalProperties: false,
          },
        },
        deliveryAddress: { type: "string", description: "Delivery address if the customer gave one for this order." },
        notes: { type: "string", description: "Anything else the shop should know (delivery time, gift, etc.)." },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "get_order_status",
    description:
      "Look up this customer's orders and their status (PENDING, CONFIRMED, PREPARING, DELIVERED, CANCELLED). Call it when the customer " +
      "asks where their order is. Pass orderNumber if they mention one; otherwise their latest orders are returned.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { orderNumber: { type: "integer", description: "Order number, e.g. 1042." } },
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description:
      "Hand the conversation to a human shop operator; you will stop answering this chat. Call it when the customer asks for a person, " +
      "complains, wants to cancel/change an existing order, asks about returns/repairs/payments you cannot answer, or when you are stuck " +
      "after trying the other tools. After calling it, tell the customer briefly that a colleague will reply soon.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "Short reason for the operator, in English." } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Input validation (model output is untrusted).
// ---------------------------------------------------------------------------------------------------------------

const id = z.string().trim().min(1).max(64);
const inputs = {
  search_products: z.object({
    query: z.string().max(200),
    category: z.string().max(80).optional(),
    brand: z.string().max(80).optional(),
    maxPrice: z.number().finite().optional(),
    limit: z.number().int().optional(),
  }),
  get_product: z.object({ productId: id }),
  get_customer: z.object({}),
  save_customer_details: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      phone: z
        .string()
        .trim()
        .max(30)
        .regex(/^\+?[\d\s\-().]{5,}$/, "phone must contain only digits, spaces, + - ( )")
        .optional(),
      address: z.string().trim().min(3).max(300).optional(),
    })
    .refine((v) => v.name || v.phone || v.address, "provide at least one of name, phone, address"),
  create_order: z.object({
    items: z
      .array(z.object({ productId: id, quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }))
      .min(1)
      .max(MAX_ORDER_LINES),
    deliveryAddress: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  get_order_status: z.object({ orderNumber: z.number().int().positive().max(2_000_000_000).optional() }),
  handoff_to_human: z.object({ reason: z.string().trim().min(1).max(500) }),
};
type ToolName = keyof typeof inputs;

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(inputs, name);
}

const ok = (data: unknown): ToolOutcome => ({ content: JSON.stringify(data), isError: false });
const fail = (error: string, extra?: Record<string, unknown>): ToolOutcome => ({
  content: JSON.stringify({ error, ...extra }),
  isError: true,
});

/** Validate and execute one tool call. Never throws for bad input; unexpected DB errors propagate. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!isToolName(name)) return fail(`Unknown tool ${name}`);
  const parsed = inputs[name].safeParse(rawInput ?? {});
  if (!parsed.success) return fail(`Invalid input: ${z.prettifyError(parsed.error)}`);
  const run = handlers[name] as (ctx: ToolContext, input: unknown) => Promise<ToolOutcome>;
  return run(ctx, parsed.data);
}

type Input<K extends ToolName> = z.infer<(typeof inputs)[K]>;
const handlers: { [K in ToolName]: (ctx: ToolContext, input: Input<K>) => Promise<ToolOutcome> } = {
  search_products: (ctx, i) => searchProducts(ctx, i),
  get_product: (ctx, i) => getProduct(ctx, i.productId),
  get_customer: (ctx) => getCustomer(ctx),
  save_customer_details: (ctx, i) => saveCustomerDetails(ctx, i),
  create_order: (ctx, i) => placeOrder(ctx, i),
  get_order_status: (ctx, i) => getOrderStatus(ctx, i.orderNumber),
  handoff_to_human: (ctx, i) => handoff(ctx, i.reason),
};

// ---------------------------------------------------------------------------------------------------------------
// Executors — every query filters by ctx.orgId (and ctx.customerId for customer data).
// ---------------------------------------------------------------------------------------------------------------

const productSelect = {
  id: true,
  name: true,
  sku: true,
  price: true,
  stock: true,
  category: true,
  brand: true,
  description: true,
  attributes: true,
} satisfies Prisma.ProductSelect;
type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

function anyFieldContains(variants: string[]): Prisma.ProductWhereInput {
  return {
    OR: variants.flatMap((v) => SEARCHABLE.map((f) => ({ [f]: { contains: v, mode: "insensitive" } }) as Prisma.ProductWhereInput)),
  };
}

function attrs(a: Prisma.JsonValue, max: number): Record<string, string> | undefined {
  if (!a || typeof a !== "object" || Array.isArray(a)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a).slice(0, max)) {
    if (v === null || typeof v === "object") continue;
    out[k.slice(0, 40)] = String(v).slice(0, 80);
  }
  return out;
}

function summary(p: ProductRow, currency: string) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: `${p.price.toFixed(2)} ${currency}`,
    stock: p.stock,
    inStock: p.stock > 0,
    brand: p.brand ?? undefined,
    category: p.category ?? undefined,
    specs: attrs(p.attributes, 8),
  };
}

async function searchProducts(ctx: ToolContext, input: Input<"search_products">): Promise<ToolOutcome> {
  const limit = Math.min(SEARCH_LIMIT_MAX, Math.max(1, input.limit ?? 5));
  const base: Prisma.ProductWhereInput[] = [{ organizationId: ctx.orgId }, { isActive: true }];
  if (input.category?.trim()) {
    base.push({ OR: termVariants(input.category).map((v) => ({ category: { contains: v, mode: "insensitive" as const } })) });
  }
  if (input.brand?.trim()) base.push({ brand: { contains: input.brand.trim(), mode: "insensitive" } });
  if (input.maxPrice !== undefined) base.push({ price: { lte: new Prisma.Decimal(Math.max(0, input.maxPrice)) } });

  const groups = searchTermGroups(input.query);
  const hasFilter = base.length > 2;
  const rank = (rows: ProductRow[]) => rows.sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0));

  // 1) every word matches (in any field). A query of only filler words with no filter falls through to 3).
  const exact =
    groups.length === 0 && !hasFilter
      ? []
      : await prisma.product.findMany({
          where: { AND: [...base, ...groups.map(anyFieldContains)] },
          select: productSelect,
          orderBy: { name: "asc" },
          take: 30,
        });
  if (exact.length) {
    return ok({
      matchType: "all_terms",
      currency: ctx.currency,
      results: rank(exact).slice(0, limit).map((p) => summary(p, ctx.currency)),
      more: exact.length > limit ? "more matches exist; refine the query" : undefined,
    });
  }

  // 2) partial: any word matches, ranked by how many words matched.
  if (groups.length > 1) {
    const partial = await prisma.product.findMany({
      where: { AND: [...base, { OR: groups.map(anyFieldContains) }] },
      select: productSelect,
      take: 60,
    });
    if (partial.length) {
      const score = (p: ProductRow) => {
        const text = [p.name, p.sku, p.brand, p.category, p.description].filter(Boolean).join(" ").toLowerCase();
        return groups.filter((g) => g.some((v) => text.includes(v.toLowerCase()))).length;
      };
      const scored = partial
        .map((p) => ({ p, s: score(p) }))
        .sort((a, b) => b.s - a.s || Number(b.p.stock > 0) - Number(a.p.stock > 0) || a.p.name.localeCompare(b.p.name));
      return ok({
        matchType: "partial",
        currency: ctx.currency,
        results: scored.slice(0, limit).map(({ p }) => summary(p, ctx.currency)),
      });
    }
  }

  // 3) nothing: tell the model what the shop does sell.
  const cats = await prisma.product.findMany({
    where: { organizationId: ctx.orgId, isActive: true, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    take: 30,
  });
  return ok({
    matchType: "none",
    results: [],
    shopCategories: cats.map((c) => c.category),
    note: "No product matched. Do not invent one; offer the categories above or ask the customer to rephrase.",
  });
}

async function getProduct(ctx: ToolContext, productId: string): Promise<ToolOutcome> {
  const p = await prisma.product.findFirst({
    where: { id: productId, organizationId: ctx.orgId, isActive: true },
    select: productSelect,
  });
  if (!p) return fail("Product not found in this shop. Use search_products to find the right productId.");
  return ok({ ...summary(p, ctx.currency), specs: attrs(p.attributes, 30), description: p.description?.slice(0, 1000) });
}

async function getCustomer(ctx: ToolContext): Promise<ToolOutcome> {
  const c = await prisma.customer.findFirst({
    where: { id: ctx.customerId, organizationId: ctx.orgId },
    select: {
      name: true,
      phone: true,
      address: true,
      orders: {
        where: { organizationId: ctx.orgId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { number: true, status: true, total: true, createdAt: true, items: { select: { name: true, quantity: true } } },
      },
    },
  });
  if (!c) return fail("Customer not found.");
  return ok({
    known: Boolean(c.name),
    name: c.name,
    phone: c.phone,
    address: c.address,
    lastOrders: c.orders.map((o) => ({
      number: o.number,
      status: o.status,
      total: `${o.total.toFixed(2)} ${ctx.currency}`,
      date: o.createdAt.toISOString().slice(0, 10),
      items: o.items.map((i) => `${i.quantity} x ${i.name}`),
    })),
  });
}

async function saveCustomerDetails(
  ctx: ToolContext,
  input: Input<"save_customer_details">,
): Promise<ToolOutcome> {
  const { count } = await prisma.customer.updateMany({
    where: { id: ctx.customerId, organizationId: ctx.orgId },
    data: { name: input.name, phone: input.phone, address: input.address },
  });
  if (count === 0) return fail("Customer not found.");
  publish(ctx.orgId, { type: "conversation", conversationId: ctx.conversationId });
  return ok({ saved: Object.keys(input) });
}

async function placeOrder(ctx: ToolContext, input: Input<"create_order">): Promise<ToolOutcome> {
  if (ctx.state.orderIds.length > 0) {
    return fail("An order was already created in this reply. Do not create it twice; tell the customer the order number.");
  }
  const customer = await prisma.customer.findFirst({
    where: { id: ctx.customerId, organizationId: ctx.orgId },
    select: { name: true },
  });
  if (!customer?.name) {
    return fail("The customer's name is unknown. Ask for their name, save it with save_customer_details, then create the order.");
  }
  const result = await createOrder(ctx.orgId, {
    customerId: ctx.customerId,
    conversationId: ctx.conversationId,
    items: input.items,
    deliveryAddress: input.deliveryAddress,
    notes: input.notes,
  });
  if (result.ok) {
    ctx.state.orderIds.push(result.order.id);
    const o = result.order;
    return ok({
      created: true,
      orderNumber: o.number,
      total: `${o.total} ${ctx.currency}`,
      items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: `${i.unitPrice} ${ctx.currency}`, lineTotal: `${i.lineTotal} ${ctx.currency}` })),
      deliveryAddress: o.deliveryAddress,
      status: "PENDING",
    });
  }
  const e = result.error;
  switch (e.code) {
    case "OUT_OF_STOCK":
      return fail("OUT_OF_STOCK: nothing was ordered. Tell the customer the available quantity and offer alternatives.", {
        items: e.items,
      });
    case "PRODUCT_NOT_FOUND":
      return fail("PRODUCT_NOT_FOUND: some productIds are not in this shop. Call search_products again and use the returned ids.", {
        productIds: e.productIds,
      });
    case "CUSTOMER_NOT_FOUND":
      return fail("Customer not found.");
    case "INVALID_INPUT":
      return fail(`INVALID_INPUT: ${e.message}`);
  }
}

async function getOrderStatus(ctx: ToolContext, orderNumber?: number): Promise<ToolOutcome> {
  const orders = await prisma.order.findMany({
    where: { organizationId: ctx.orgId, customerId: ctx.customerId, ...(orderNumber ? { number: orderNumber } : {}) },
    orderBy: { createdAt: "desc" },
    take: orderNumber ? 1 : 3,
    select: {
      number: true,
      status: true,
      total: true,
      createdAt: true,
      deliveryAddress: true,
      items: { select: { name: true, quantity: true } },
    },
  });
  if (!orders.length) {
    return ok({ orders: [], note: orderNumber ? "No order with that number for this customer." : "This customer has no orders yet." });
  }
  return ok({
    orders: orders.map((o) => ({
      number: o.number,
      status: o.status,
      total: `${o.total.toFixed(2)} ${ctx.currency}`,
      date: o.createdAt.toISOString().slice(0, 10),
      deliveryAddress: o.deliveryAddress,
      items: o.items.map((i) => `${i.quantity} x ${i.name}`),
    })),
  });
}

async function handoff(ctx: ToolContext, reason: string): Promise<ToolOutcome> {
  const { count } = await prisma.conversation.updateMany({
    where: { id: ctx.conversationId, organizationId: ctx.orgId },
    data: { mode: "HUMAN" },
  });
  if (count === 0) return fail("Conversation not found.");
  ctx.state.handedOff = true;
  const customer = await prisma.customer.findFirst({
    where: { id: ctx.customerId, organizationId: ctx.orgId },
    select: { name: true, externalId: true },
  });
  await notify(ctx.orgId, {
    type: "HUMAN_NEEDED",
    title: `${customer?.name ?? customer?.externalId ?? "A customer"} needs a human`,
    body: reason,
    link: `/conversations/${ctx.conversationId}`,
  });
  publish(ctx.orgId, { type: "conversation", conversationId: ctx.conversationId });
  await logActivity({
    orgId: ctx.orgId,
    action: "conversation.handoff",
    entityType: "conversation",
    entityId: ctx.conversationId,
    meta: { reason, by: "AI" },
  });
  return ok({ handedOff: true, instruction: "Tell the customer briefly that a colleague will reply soon. Do not call more tools." });
}
