import "server-only";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { getMyTeamIds } from "@/lib/auth/authz";
import {
  createEvent,
  getEventById,
  isValidTopic,
  listRecentVisibleEvents,
  topicMatches,
} from "@/lib/db/events";

// ────────────────────────────────────────────────────────────────────
// event_* MCP tools — the agent-facing surface of the event bus.
// Registered only when the agent config has enableEventTools=1.
//
// event_emit publishes onto the bus (source="agent"); the dispatcher fans
// each event out to matching subscriptions. chainDepth propagates event →
// session → event so a runaway loop is refused past EVENT_MAX_CHAIN_DEPTH.
// ────────────────────────────────────────────────────────────────────

const MAX_CHAIN_DEPTH = Number(process.env.EVENT_MAX_CHAIN_DEPTH ?? 5);

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

type SessionRow = typeof sessions.$inferSelect;

async function loadSession(sessionId: string): Promise<SessionRow | null> {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

export function buildEventTools(sessionId: string) {
  return [
    tool(
      "event_emit",
      "Publish an event onto the workspace event bus. Agents subscribed to a matching topic each get a new session spawned for them. Use dot-namespaced lowercase topics (e.g. 'deploy.finished', 'ticket.triaged'). The payload is arbitrary JSON context the subscribers will read.",
      {
        topic: z
          .string()
          .min(1)
          .describe(
            "Dot-namespaced lowercase topic, e.g. 'deploy.finished'. No wildcards.",
          ),
        payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional JSON object of context for subscribers."),
      },
      async (args) => {
        const session = await loadSession(sessionId);
        if (!session) return textResult("Error: session not found.");

        const topic = args.topic.trim();
        if (!isValidTopic(topic)) {
          return textResult(
            `Error: invalid topic "${topic}". Use lowercase dot-separated segments (letters/digits), e.g. "deploy.finished". No wildcards.`,
          );
        }

        // Chain depth: inherit from the event that triggered THIS session
        // (if any) + 1. A non-event session roots the chain at 0.
        let triggeringDepth = -1;
        if (session.triggerEventId) {
          const trigger = await getEventById(session.triggerEventId);
          if (trigger) triggeringDepth = trigger.chainDepth;
        }
        const chainDepth = triggeringDepth + 1;
        if (chainDepth > MAX_CHAIN_DEPTH) {
          return textResult(
            `Error: event chain depth limit (${MAX_CHAIN_DEPTH}) reached — refusing to emit "${topic}" to avoid a runaway trigger loop. This session was itself spawned deep in an event chain.`,
          );
        }

        const event = await createEvent({
          ownerId: session.ownerId ?? session.userId,
          teamId: session.teamId,
          topic,
          payloadJson: (args.payload ?? {}) as Record<string, unknown>,
          source: "agent",
          sourceSessionId: session.id,
          sourceAgentConfigId: session.agentConfigId,
          chainDepth,
        });

        return textResult(
          `Event emitted: "${topic}" (id ${event.id}, depth ${chainDepth}). Subscribers matching this topic will be dispatched within ~15s.`,
        );
      },
    ),

    tool(
      "event_recent",
      "List recent events on the bus visible to you (your own + your team's). Optionally filter by an exact topic or a 'prefix.*' wildcard. Returns topic, source, time and payload for each.",
      {
        topic: z
          .string()
          .optional()
          .describe(
            "Optional filter: exact topic ('deploy.finished') or prefix wildcard ('deploy.*').",
          ),
        limit: z.number().int().min(1).max(100).default(20),
      },
      async (args) => {
        const session = await loadSession(sessionId);
        if (!session) return textResult("Error: session not found.");
        const ownerId = session.ownerId ?? session.userId;
        const myTeamIds = await getMyTeamIds(ownerId);

        let rows = await listRecentVisibleEvents(ownerId, myTeamIds, 100);
        if (args.topic) {
          const pattern = args.topic.trim();
          rows = rows.filter((e) => topicMatches(pattern, e.topic));
        }
        rows = rows.slice(0, args.limit);

        if (rows.length === 0) return textResult("No matching events.");
        const lines = rows.map((e) => {
          const payload = JSON.stringify(e.payloadJson);
          const short =
            payload.length > 300 ? `${payload.slice(0, 300)}…` : payload;
          return `- [${e.createdAt.toISOString()}] ${e.topic} (${e.source}): ${short}`;
        });
        return textResult(lines.join("\n"));
      },
    ),
  ];
}
