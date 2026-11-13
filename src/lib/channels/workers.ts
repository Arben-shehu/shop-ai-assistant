import "server-only";
import { startOutbox } from "@/lib/channels/outbox";
import { startChannelMonitor } from "@/lib/channels/monitor";

/**
 * Starts the outbox worker and the OpenWA health monitor / webhook reconciler (idempotent, once per process).
 * Meant to be called from src/instrumentation.ts register(); until that exists it is also called lazily
 * from sendToCustomer(), the webhook routes and the channels page.
 */
export function ensureChannelWorkers() {
  startOutbox();
  startChannelMonitor();
}
