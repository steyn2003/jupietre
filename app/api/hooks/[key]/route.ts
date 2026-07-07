import type { NextRequest } from "next/server";
import { createEvent, getWebhookByKey } from "@/lib/db/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ────────────────────────────────────────────────────────────────────
// Webhook ingest — the external entry point onto the event bus. NO session
// auth: callers are third-party systems that only hold the URL path secret
// (`webhooks.key`). An unknown or disabled key 404s so the endpoint doesn't
// leak which keys exist.
// ────────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 64 * 1024;

// In-module per-webhook rate limiter — single-process is the established
// assumption everywhere else (poller, dispatcher). 60 requests / rolling min.
const RATE_MAX = 60;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;

  const webhook = await getWebhookByKey(key);
  if (!webhook || webhook.enabled !== 1) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (rateLimited(key)) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  // Tolerate non-JSON: wrap the raw body so the event still carries the
  // caller's data. Empty body → {}.
  let payload: Record<string, unknown>;
  if (raw.trim() === "") {
    payload = {};
  } else {
    try {
      const parsed = JSON.parse(raw) as unknown;
      payload =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { value: parsed };
    } catch {
      payload = { raw };
    }
  }

  const event = await createEvent({
    ownerId: webhook.ownerId,
    teamId: webhook.teamId,
    topic: webhook.topic,
    payloadJson: payload,
    source: "webhook",
    chainDepth: 0,
  });

  return Response.json({ eventId: event.id });
}
