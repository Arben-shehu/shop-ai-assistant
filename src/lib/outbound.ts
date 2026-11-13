import "server-only";

/**
 * CONTRACT (owned by the channels agent): send a text to the conversation's customer through its channel,
 * save the OUTBOUND Message (sender AI or OPERATOR, error set if sending failed), bump lastMessageAt,
 * and publish { type: "message" }. Returns the saved message id. Throws only on invalid conversation.
 */
export async function sendToCustomer(
  _conversationId: string,
  _text: string,
  _from: { sender: "AI" } | { sender: "OPERATOR"; operatorId: string },
): Promise<{ messageId: string; ok: boolean }> {
  throw new Error("sendToCustomer: not implemented yet");
}
