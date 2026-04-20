import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { loadReadableSession } from "@/lib/auth/authz";
import { subscribe, type StreamEvent } from "@/lib/agent/runner";

// Keep this in the Node runtime so SSE + the runner's in-memory registry work.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const row = await loadReadableSession(id, session.userId);
  if (!row) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      unsubscribe = subscribe(id, send);
      // 25s heartbeat so intermediaries don't close the stream
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 25_000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
