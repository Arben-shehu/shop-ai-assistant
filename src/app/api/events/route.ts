import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { bus, type LiveEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/** Server-Sent Events stream of LiveEvents for the caller's active shop. */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const orgId = session?.session.activeOrganizationId;
  if (!orgId) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: LiveEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 25_000);
      bus.on(orgId, send);
      cleanup = () => {
        clearInterval(ping);
        bus.off(orgId, send);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        controller.close();
      });
    },
    cancel: () => cleanup(),
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
