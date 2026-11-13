import "server-only";
import type { InboundMessage } from "@/lib/channels/types";

/**
 * CONTRACT (owned by the AI agent): called by every webhook after verifying + normalising a message.
 * Must: find Channel by (type, externalId) -> upsert Customer -> upsert Conversation -> save Message
 * (drop duplicates by externalId) -> publish live events -> if conversation.mode === "AI" and shop aiEnabled,
 * generate a reply and send it with sendToCustomer(). Must never throw to the webhook (log instead).
 */
export async function handleInbound(_msg: InboundMessage): Promise<void> {
  throw new Error("handleInbound: not implemented yet");
}
