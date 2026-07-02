import "server-only";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { repos, sessionMessages, sessions } from "@/lib/db/schema";
import {
  getAgentConfigBySlug,
  listAgentConfigs,
} from "@/lib/db/agent-configs";
import { spawnAgentSession, sendToSession } from "@/lib/agent/spawn";
import { subscribe } from "@/lib/agent/runner";

// ────────────────────────────────────────────────────────────────────
// agent_* delegation tools — what turns any agent into an orchestrator.
// Registered only when the agent config has enableAgentTools=1.
//
// Model: agent_spawn starts a sub-agent in its own session + worktree and
// returns immediately; the parent then agent_wait's for the result (blocking
// tool call, same pattern as the approval gate) and can agent_send follow-ups.
// Parent/child linkage rides the existing sessions.parentSessionId column.
// ────────────────────────────────────────────────────────────────────

// ponytail: fixed depth/fan-out caps; make per-agent config if anyone hits them.
const MAX_DEPTH = 2; // a sub-agent may spawn sub-sub-agents, no deeper
const MAX_CHILDREN = 20; // per parent session

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

async function depthOf(row: SessionRow): Promise<number> {
  let depth = 0;
  let cur: SessionRow | null = row;
  while (cur?.parentSessionId && depth <= MAX_DEPTH) {
    depth += 1;
    cur = await loadSession(cur.parentSessionId);
  }
  return depth;
}

/** A child this session spawned via agent_spawn — the only sessions the
 *  delegation tools may act on. Guards against a prompt-injected agent
 *  poking arbitrary sessions. */
async function loadOwnChild(
  parentSessionId: string,
  childSessionId: string,
): Promise<SessionRow | null> {
  const child = await loadSession(childSessionId);
  if (!child || child.parentSessionId !== parentSessionId) return null;
  return child;
}

async function lastAssistantText(sessionId: string): Promise<string | null> {
  const rows = await db
    .select({ text: sessionMessages.text })
    .from(sessionMessages)
    .where(
      and(
        eq(sessionMessages.sessionId, sessionId),
        eq(sessionMessages.kind, "assistant"),
      ),
    )
    .orderBy(desc(sessionMessages.indexInSession))
    .limit(1);
  return rows[0]?.text ?? null;
}

/** Block until the session's status leaves "running" (or the deadline hits).
 *  Event-driven via the runner's in-process pubsub, with a slow poll as a
 *  belt against a missed event. */
async function waitForIdle(
  sessionId: string,
  timeoutMs: number,
): Promise<"idle" | "error" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await loadSession(sessionId);
    if (!row) return "error";
    if (row.status !== "running") return row.status as "idle" | "error";
    await new Promise<void>((resolve) => {
      const unsub = subscribe(sessionId, (e) => {
        if (e.type === "status") {
          unsub();
          resolve();
        }
      });
      setTimeout(() => {
        unsub();
        resolve();
      }, Math.min(10_000, Math.max(0, deadline - Date.now())));
    });
  }
  return "timeout";
}

export function buildDelegateTools(sessionId: string) {
  return [
    tool(
      "agent_list",
      "List the agents you can delegate to with agent_spawn. Returns slug, name and a one-line role summary for each.",
      {},
      async () => {
        const parent = await loadSession(sessionId);
        if (!parent) return textResult("Error: session not found.");
        const agents = await listAgentConfigs(parent.ownerId ?? parent.userId);
        if (agents.length === 0) return textResult("No agents configured.");
        const lines = agents.map((a) => {
          const firstLine = a.systemPrompt.split("\n")[0]?.slice(0, 120) ?? "";
          return `- ${a.slug} — ${a.name} (${a.model}): ${firstLine}`;
        });
        return textResult(lines.join("\n"));
      },
    ),

    tool(
      "agent_spawn",
      "Spawn a sub-agent to work on a task in its own session and git worktree. Returns the sub-agent's session id immediately — it works in the background. Use agent_wait to block until it finishes, agent_send to give it follow-up instructions. The sub-agent sees ONLY the task text you pass — include everything it needs (scope, files, acceptance criteria).",
      {
        agent: z
          .string()
          .describe("Agent slug to run (see agent_list), e.g. 'engineer'."),
        task: z
          .string()
          .min(1)
          .describe(
            "The full task brief. Written like a message to a colleague who has no other context.",
          ),
        title: z
          .string()
          .optional()
          .describe("Optional short session title shown in the UI."),
      },
      async (args) => {
        const parent = await loadSession(sessionId);
        if (!parent) return textResult("Error: session not found.");

        const depth = await depthOf(parent);
        if (depth >= MAX_DEPTH) {
          return textResult(
            `Error: max delegation depth (${MAX_DEPTH}) reached — do this task yourself instead of delegating further.`,
          );
        }
        const [{ value: childCount }] = await db
          .select({ value: count() })
          .from(sessions)
          .where(eq(sessions.parentSessionId, sessionId));
        if (childCount >= MAX_CHILDREN) {
          return textResult(
            `Error: this session already spawned ${childCount} sub-agents (max ${MAX_CHILDREN}).`,
          );
        }

        const ownerId = parent.ownerId ?? parent.userId;
        const agent = await getAgentConfigBySlug(ownerId, args.agent);
        if (!agent) {
          return textResult(
            `Error: no agent with slug "${args.agent}". Call agent_list to see what's available.`,
          );
        }

        let repo = null;
        if (parent.repoId) {
          const r = (
            await db
              .select()
              .from(repos)
              .where(eq(repos.id, parent.repoId))
              .limit(1)
          )[0];
          if (r) {
            repo = {
              id: r.id,
              slug: r.slug,
              clonePath: r.clonePath,
              defaultBranch: r.defaultBranch,
            };
          }
        }

        const childId = await spawnAgentSession({
          userId: ownerId,
          teamId: parent.teamId,
          agentConfigId: agent.id,
          title: args.title ?? `${agent.name} ← ${parent.title}`.slice(0, 120),
          source: "agent",
          repo,
          repoPath: repo ? undefined : parent.repoPath,
          kickoff: [
            `## 🤝 Delegated task from "${parent.title}"`,
            "",
            args.task,
          ].join("\n"),
          extra: { parentSessionId: sessionId },
        });

        return textResult(
          `Sub-agent spawned: session ${childId} (agent=${agent.slug}). It runs in its own worktree. Call agent_wait with this session id to get its result.`,
        );
      },
    ),

    tool(
      "agent_wait",
      "Block until a sub-agent you spawned finishes its current turn, then return its final message. Call this after agent_spawn (or agent_send) when you need the result before continuing.",
      {
        session_id: z.string().describe("Session id returned by agent_spawn."),
        timeout_seconds: z
          .number()
          .int()
          .min(10)
          .max(3600)
          .default(900)
          .describe("Max seconds to wait (default 900)."),
      },
      async (args) => {
        const child = await loadOwnChild(sessionId, args.session_id);
        if (!child) {
          return textResult(
            "Error: that session id is not a sub-agent of this session.",
          );
        }
        const outcome = await waitForIdle(
          args.session_id,
          args.timeout_seconds * 1000,
        );
        if (outcome === "timeout") {
          return textResult(
            `Sub-agent ${args.session_id} still running after ${args.timeout_seconds}s. Call agent_wait again to keep waiting, or agent_send to redirect it.`,
          );
        }
        const text = await lastAssistantText(args.session_id);
        return textResult(
          [
            `Sub-agent ${args.session_id} finished (status=${outcome}).`,
            "",
            "--- final message ---",
            text ?? "(no assistant output)",
          ].join("\n"),
        );
      },
    ),

    tool(
      "agent_send",
      "Send a follow-up message to a sub-agent you spawned — rework notes, an answer to something it needed, extra scope. Resumes its session with your text; use agent_wait afterwards for the response.",
      {
        session_id: z.string().describe("Session id returned by agent_spawn."),
        message: z.string().min(1).describe("The follow-up message."),
      },
      async (args) => {
        const child = await loadOwnChild(sessionId, args.session_id);
        if (!child) {
          return textResult(
            "Error: that session id is not a sub-agent of this session.",
          );
        }
        await sendToSession({
          sessionId: args.session_id,
          currentStatus: child.status,
          text: args.message,
        });
        return textResult(
          `Message delivered to sub-agent ${args.session_id}. Call agent_wait to get its response.`,
        );
      },
    ),
  ];
}
