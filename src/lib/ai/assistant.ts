import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getShopSettings } from "@/lib/shop-settings";
import { TOOL_DEFINITIONS, runTool, type ToolContext } from "@/lib/ai/tools";
import { buildHistory, HISTORY_LIMIT, type HistoryRow } from "@/lib/ai/history";
import { buildSystemPrompt } from "@/lib/ai/prompt";

export const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
/** Chat replies don't need deep reasoning; thinking can't be disabled on claude-opus-5-5, effort keeps it short. */
const EFFORT = "low" as const;
const MAX_TOKENS = 8000;
/** Model calls per reply (each tool round-trip is one). */
const MAX_ITERATIONS = 8;

let client: Anthropic | undefined;
function getClient() {
  // Reads ANTHROPIC_API_KEY (and optional ANTHROPIC_BASE_URL) from env.
  return (client ??= new Anthropic({ maxRetries: 2, timeout: 90_000 }));
}

export type AssistantErrorReason = "not_found" | "refusal" | "max_tokens" | "too_many_iterations" | "empty_reply";
export class AssistantError extends Error {
  constructor(
    readonly reason: AssistantErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "AssistantError";
  }
}

export type ReplyUsage = {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type GeneratedReply = {
  /** Text to send, or null when there is nothing to answer (no new customer message). */
  text: string | null;
  /** Inbound message ids this reply answered (the trailing customer turn). */
  answeredIds: string[];
  /** The model called handoff_to_human: conversation is now HUMAN, but this closing text should still be sent. */
  handedOff: boolean;
  orderIds: string[];
  toolCalls: string[];
  usage: ReplyUsage;
};

/**
 * Generate the assistant's reply for a conversation. Does not send anything.
 * `answerIds`: inbound message ids that must be answered even if a reply was saved after them
 * (a message that arrived while the previous reply was being generated).
 */
export async function generateReply(args: {
  orgId: string;
  conversationId: string;
  answerIds?: string[];
}): Promise<GeneratedReply> {
  const { orgId, conversationId } = args;
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: orgId },
    select: { id: true, customerId: true },
  });
  if (!conversation) throw new AssistantError("not_found", `conversation ${conversationId} not found in org ${orgId}`);

  const shop = await getShopSettings(orgId);
  const rowSelect = {
    id: true,
    direction: true,
    sender: true,
    status: true,
    text: true,
    mediaUrl: true,
    mediaType: true,
    createdAt: true,
  } as const;
  const recent: HistoryRow[] = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: rowSelect,
  });
  const missing = (args.answerIds ?? []).filter((id) => !recent.some((r) => r.id === id));
  if (missing.length) {
    recent.push(...(await prisma.message.findMany({ where: { conversationId, id: { in: missing } }, select: rowSelect })));
  }

  const usage: ReplyUsage = { requests: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const ctx: ToolContext = {
    orgId,
    conversationId,
    customerId: conversation.customerId,
    currency: shop.currency,
    state: { handedOff: false, orderIds: [] },
  };
  const toolCalls: string[] = [];
  const result = (text: string | null, answeredIds: string[]): GeneratedReply => ({
    text,
    answeredIds,
    handedOff: ctx.state.handedOff,
    orderIds: ctx.state.orderIds,
    toolCalls,
    usage,
  });

  let history = buildHistory(recent, { answerIds: args.answerIds, images: true });
  if (history.messages.length === 0) return result(null, []);

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildSystemPrompt(shop), cache_control: { type: "ephemeral" } },
  ];
  const messages: Anthropic.MessageParam[] = [...history.messages];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response: Anthropic.Message;
    try {
      response = await getClient().messages.create({
        model: AI_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: TOOL_DEFINITIONS,
        messages,
        output_config: { effort: EFFORT },
        // Automatic breakpoint on the last block: each tool round-trip re-reads the previous one from cache.
        cache_control: { type: "ephemeral" },
      });
    } catch (e) {
      // An image URL the API can't fetch (expired CDN link, unsupported type) fails the whole request:
      // retry the first call once with images replaced by a text placeholder.
      if (e instanceof Anthropic.BadRequestError && i === 0 && history.hasImages) {
        console.warn("[ai] request with images rejected, retrying without images:", e.message);
        history = buildHistory(recent, { answerIds: args.answerIds, images: false });
        messages.splice(0, messages.length, ...history.messages);
        continue;
      }
      throw e;
    }

    usage.requests++;
    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

    switch (response.stop_reason) {
      case "refusal":
        throw new AssistantError("refusal", `model refused: ${response.stop_details?.explanation ?? "no details"}`);
      case "max_tokens":
        // Never act on a possibly truncated tool input or half-written reply.
        throw new AssistantError("max_tokens", "reply hit max_tokens");
      case "pause_turn":
        messages.push({ role: "assistant", content: response.content });
        continue;
      case "tool_use": {
        // Full content (incl. thinking blocks) goes back unchanged; tools run sequentially so
        // save_customer_details → create_order in the same response sees the saved name.
        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          toolCalls.push(block.name);
          let outcome;
          try {
            outcome = await runTool(block.name, block.input, ctx);
          } catch (e) {
            console.error(`[ai] tool ${block.name} failed`, e);
            outcome = { content: JSON.stringify({ error: "Internal error, try again or hand off to a human." }), isError: true };
          }
          results.push({ type: "tool_result", tool_use_id: block.id, content: outcome.content, is_error: outcome.isError });
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      default: {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (!text && !ctx.state.handedOff) throw new AssistantError("empty_reply", "model returned no text");
        return result(text || null, history.answeredIds);
      }
    }
  }
  throw new AssistantError("too_many_iterations", `no final reply after ${MAX_ITERATIONS} model calls`);
}
