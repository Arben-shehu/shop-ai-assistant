// Runs once per server start. Starts the background workers of the messaging channels (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureChannelWorkers } = await import("@/lib/channels/workers");
  ensureChannelWorkers();
}
