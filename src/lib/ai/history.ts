import type Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@/generated/prisma/client";

/** Pure: turns stored chat rows into Claude messages. No DB / network, unit-testable. */

export const HISTORY_LIMIT = 20;
const MAX_TEXT = 4000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export type HistoryRow = Pick<Message, "id" | "direction" | "sender" | "status" | "text" | "mediaUrl" | "mediaType" | "createdAt">;

export type BuiltHistory = {
  /** Starts and ends with a user turn, roles alternate. Empty when there is no customer message to answer. */
  messages: Anthropic.MessageParam[];
  /** Inbound ids placed in the final (to-be-answered) user turn. */
  answeredIds: string[];
  hasImages: boolean;
};

/**
 * - INBOUND → user, OUTBOUND (AI / OPERATOR) → assistant; outbound rows that FAILED are skipped (the customer never saw them).
 * - The final user turn = inbound rows after the last outbound row, plus `answerIds` (messages that arrived while the
 *   previous reply was being generated and therefore sort before it). Guarantees the history never ends on an
 *   assistant turn (that would be a prefill, rejected by the API).
 * - Real image blocks only in the final turn (older provider media URLs expire); earlier media become placeholders.
 */
export function buildHistory(rows: HistoryRow[], opts: { answerIds?: string[]; images?: boolean } = {}): BuiltHistory {
  const answer = new Set(opts.answerIds ?? []);
  const sorted = [...rows]
    .filter((r) => !(r.direction === "OUTBOUND" && r.status === "FAILED"))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  let lastOut = -1;
  sorted.forEach((r, i) => {
    if (r.direction === "OUTBOUND") lastOut = i;
  });
  const isTrailing = (r: HistoryRow, i: number) => r.direction === "INBOUND" && (i > lastOut || answer.has(r.id));
  const trailing = sorted.filter(isTrailing);
  const earlier = sorted.filter((r, i) => !isTrailing(r, i));
  if (trailing.length === 0) return { messages: [], answeredIds: [], hasImages: false };

  const turns: { role: "user" | "assistant"; content: Anthropic.ContentBlockParam[] }[] = [];
  const push = (role: "user" | "assistant", blocks: Anthropic.ContentBlockParam[]) => {
    if (!blocks.length) return;
    const last = turns.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else turns.push({ role, content: blocks });
  };

  for (const r of earlier) push(r.direction === "INBOUND" ? "user" : "assistant", rowBlocks(r, false));
  while (turns[0]?.role === "assistant") turns.shift(); // must start with a user turn

  let hasImages = false;
  const finalBlocks: Anthropic.ContentBlockParam[] = [];
  for (const r of trailing) {
    const blocks = rowBlocks(r, opts.images ?? true);
    if (blocks.some((b) => b.type === "image")) hasImages = true;
    finalBlocks.push(...blocks);
  }
  if (!finalBlocks.length) finalBlocks.push({ type: "text", text: "[empty message]" });
  push("user", finalBlocks);

  return { messages: turns, answeredIds: trailing.map((r) => r.id), hasImages };
}

function rowBlocks(r: HistoryRow, allowImage: boolean): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const who = r.direction === "INBOUND" ? "customer" : r.sender === "OPERATOR" ? "shop operator" : "you";
  if (r.mediaUrl || r.mediaType) {
    const image = allowImage && r.direction === "INBOUND" ? imageBlock(r.mediaUrl, r.mediaType) : null;
    if (image) blocks.push(image);
    else blocks.push({ type: "text", text: `[${who} sent ${mediaLabel(r.mediaType)}${allowImage ? " that cannot be opened" : ""}]` });
  }
  const text = r.text?.trim();
  if (text) {
    const body = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)} [...]` : text;
    blocks.push({ type: "text", text: r.sender === "OPERATOR" ? `[shop operator] ${body}` : body });
  }
  return blocks;
}

function mediaLabel(type: string | null): string {
  if (!type) return "an attachment";
  if (type.startsWith("image")) return "an image";
  if (type.startsWith("audio")) return "a voice/audio message";
  if (type.startsWith("video")) return "a video";
  return "a file";
}

function imageBlock(url: string | null, type: string | null): Anthropic.ImageBlockParam | null {
  if (!url) return null;
  const data = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(url);
  if (data) {
    const mt = normaliseType(data[1]);
    return mt ? { type: "image", source: { type: "base64", media_type: mt, data: data[2] } } : null;
  }
  if (!/^https:\/\//i.test(url)) return null;
  if (type && !normaliseType(type)) return null; // e.g. image/heic, audio/ogg
  if (!type && !/\.(jpe?g|png|gif|webp)(\?|$)/i.test(url)) return null;
  return { type: "image", source: { type: "url", url } };
}

function normaliseType(t: string): ImageType | null {
  const lower = t.toLowerCase().split(";")[0].trim().replace("image/jpg", "image/jpeg");
  return (IMAGE_TYPES as readonly string[]).includes(lower) ? (lower as ImageType) : null;
}
