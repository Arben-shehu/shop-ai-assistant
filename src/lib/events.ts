import "server-only";
import { EventEmitter } from "node:events";

// shortcut: in-process bus, works for a single Node instance only; move to Postgres LISTEN/NOTIFY or Redis when running >1 instance.
const g = globalThis as unknown as { liveBus?: EventEmitter };
export const bus = (g.liveBus ??= new EventEmitter().setMaxListeners(0));

export type LiveEvent =
  | { type: "message"; conversationId: string }
  | { type: "conversation"; conversationId: string }
  | { type: "order"; orderId: string }
  | { type: "notification" }
  | { type: "channel"; channelId: string };

/** Notify every open dashboard of this shop. */
export function publish(orgId: string, event: LiveEvent) {
  bus.emit(orgId, event);
}
