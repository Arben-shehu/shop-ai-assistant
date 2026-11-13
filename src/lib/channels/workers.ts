import "server-only";
import { startOutbox } from "@/lib/channels/outbox";
import { startChannelMonitor } from "@/lib/channels/monitor";
import { startOrderStatusSync } from "@/lib/inventory/status-sync";

/**
 * Starts the outbox worker, the OpenWA health monitor / webhook reconciler and the ERP order-status sync
 * (idempotent, once per process).
 * Meant to be called from src/instrumentation.ts register(); until that exists it is also called lazily
 * from sendToCustomer(), the webhook routes and the channels page.
 */
export function ensureChannelWorkers() {
  startOutbox();
  startChannelMonitor();
  startOrderStatusSync();
}
