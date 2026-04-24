import "server-only";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import {
  getRun,
  getWorkflow,
  publishMessage,
} from "@/lib/workflows/runs";
import {
  handoffPayloadSchema,
  parseWorkflowDefinition,
  TRANSITION_KINDS,
  type TransitionKind,
  type WorkflowDefinition,
} from "@/lib/workflows/definitions";

// ────────────────────────────────────────────────────────────────────
// Helper: load the workflow context for the current session. Every tool
// calls this first. Returns null (+ an error message) if this session
// isn't participating in a workflow — the tool surfaces that to the
// agent as a tool result, no throw.
// ────────────────────────────────────────────────────────────────────

interface WorkflowContext {
  runId: string;
  currentNode: string;
  definition: WorkflowDefinition;
}

async function loadContext(
  sessionId: string,
): Promise<{ ctx: WorkflowContext } | { error: string }> {
  const row = (
    await db
      .select({
        workflowRunId: sessions.workflowRunId,
        workflowNodeSlug: sessions.workflowNodeSlug,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
  )[0];
  if (!row?.workflowRunId || !row.workflowNodeSlug) {
    return {
      error:
        "This session is not part of a workflow run — workflow_* tools are unavailable here.",
    };
  }
  const run = await getRun(row.workflowRunId);
  if (!run) {
    return { error: `Workflow run ${row.workflowRunId} not found.` };
  }
  if (run.status === "done" || run.status === "error") {
    return {
      error: `Workflow run is already ${run.status} — no further messages accepted.`,
    };
  }
  const workflow = await getWorkflow(run.workflowId);
  if (!workflow) {
    return { error: `Workflow ${run.workflowId} no longer exists.` };
  }
  const definition = parseWorkflowDefinition(workflow.definition);
  return {
    ctx: {
      runId: run.id,
      currentNode: row.workflowNodeSlug,
      definition,
    },
  };
}

function findTransition(
  def: WorkflowDefinition,
  from: string,
  kind: TransitionKind,
  to: string,
) {
  return def.transitions.find(
    (t) => t.from === from && t.kind === kind && t.to === to,
  );
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ────────────────────────────────────────────────────────────────────
// The four workflow tools. sessionId is captured by closure so the
// handlers can't be spoofed into acting on behalf of another session.
// ────────────────────────────────────────────────────────────────────

export function buildWorkflowTools(sessionId: string) {
  return [
    tool(
      "workflow_handoff",
      "Hand off work to the next agent in the workflow. The receiving agent gets only the payload you pass — no transcripts, no prior context. Include anything they'll need (scope, files to touch, DoD, out-of-scope notes, refs to PRs/issues).",
      {
        to: z
          .string()
          .describe(
            "Target node slug within the workflow (e.g. 'eng', 'qa'). Must be a legal handoff target from your current node.",
          ),
        message: z
          .string()
          .min(1)
          .describe(
            "Short plain-language handoff note — what to do, why. Treat it like a message to a colleague.",
          ),
        files: z
          .array(z.string())
          .optional()
          .describe("Optional list of repo file paths the next agent will touch."),
        dod: z
          .array(z.string())
          .optional()
          .describe("Optional Definition of Done — each entry is one acceptance criterion."),
        outOfScope: z
          .array(z.string())
          .optional()
          .describe("Optional guardrails — things the next agent should NOT change."),
        refs: z
          .array(
            z.object({
              kind: z.enum(["pr", "commit", "issue", "branch"]),
              value: z.string(),
            }),
          )
          .optional()
          .describe(
            "Optional pointers (PR URL, commit SHA, issue id, branch name) — pointers only, never content.",
          ),
      },
      async (args) => {
        const loaded = await loadContext(sessionId);
        if ("error" in loaded) return textResult(`Error: ${loaded.error}`);
        const { ctx } = loaded;

        const transition = findTransition(ctx.definition, ctx.currentNode, "handoff", args.to);
        if (!transition) {
          const legal = ctx.definition.transitions
            .filter((t) => t.from === ctx.currentNode && t.kind === "handoff")
            .map((t) => t.to)
            .join(", ");
          return textResult(
            `Error: no handoff transition from "${ctx.currentNode}" to "${args.to}". Legal handoff targets: ${legal || "(none)"}.`,
          );
        }

        const payloadParse = handoffPayloadSchema.safeParse({
          message: args.message,
          files: args.files,
          dod: args.dod,
          outOfScope: args.outOfScope,
          refs: args.refs,
        });
        if (!payloadParse.success) {
          return textResult(
            `Error: handoff payload invalid: ${payloadParse.error.message}`,
          );
        }

        const msg = await publishMessage({
          workflowRunId: ctx.runId,
          fromNode: ctx.currentNode,
          toNode: args.to,
          kind: "handoff",
          payloadJson: payloadParse.data as unknown as Record<string, unknown>,
        });
        return textResult(
          `Handoff queued (${msg.id}): ${ctx.currentNode} → ${args.to}. The dispatcher will spawn a session for "${args.to}" on the next tick.`,
        );
      },
    ),

    tool(
      "workflow_ask",
      "Ask another agent in this workflow a clarifying question. A new session is spawned for them; when they call workflow_answer, your session resumes with their reply.",
      {
        to: z
          .string()
          .describe("Target node slug. Must be a legal ask target from your current node."),
        question: z
          .string()
          .min(1)
          .describe("The question — short and specific."),
      },
      async (args) => {
        const loaded = await loadContext(sessionId);
        if ("error" in loaded) return textResult(`Error: ${loaded.error}`);
        const { ctx } = loaded;

        const transition = findTransition(ctx.definition, ctx.currentNode, "ask", args.to);
        if (!transition) {
          const legal = ctx.definition.transitions
            .filter((t) => t.from === ctx.currentNode && t.kind === "ask")
            .map((t) => t.to)
            .join(", ");
          return textResult(
            `Error: no ask transition from "${ctx.currentNode}" to "${args.to}". Legal ask targets: ${legal || "(none)"}.`,
          );
        }

        const msg = await publishMessage({
          workflowRunId: ctx.runId,
          fromNode: ctx.currentNode,
          toNode: args.to,
          kind: "ask",
          payloadJson: { text: args.question },
        });
        return textResult(
          `Question queued (${msg.id}): ${ctx.currentNode} → ${args.to}. Your session will resume with their answer when they reply.`,
        );
      },
    ),

    tool(
      "workflow_answer",
      "Answer a question another agent asked you. Use this after reading an incoming ❓ ask message. Your answer resumes the asker's session — they pick up right where they left off.",
      {
        to: z
          .string()
          .describe("Node slug that asked you the question (the `from` in the incoming ask message)."),
        answer: z
          .string()
          .min(1)
          .describe("Your answer."),
      },
      async (args) => {
        const loaded = await loadContext(sessionId);
        if ("error" in loaded) return textResult(`Error: ${loaded.error}`);
        const { ctx } = loaded;

        // answer isn't a declared transition direction — it's the reverse
        // channel of ask. The DAG check: there must be an ask from `to` to
        // us (confirming the asker could legally have reached us in the
        // first place), AND our node must list "answer" in canReceive...
        // wait, the ASKER's node is what receives the answer. So check:
        // target node's canReceive must include "answer".
        const targetNode = ctx.definition.nodes[args.to];
        if (!targetNode) {
          return textResult(
            `Error: unknown node "${args.to}".`,
          );
        }
        if (!targetNode.canReceive.includes("answer")) {
          return textResult(
            `Error: node "${args.to}" cannot receive answers (canReceive=${targetNode.canReceive.join(",")}).`,
          );
        }
        const askExists = ctx.definition.transitions.some(
          (t) => t.from === args.to && t.kind === "ask" && t.to === ctx.currentNode,
        );
        if (!askExists) {
          return textResult(
            `Error: "${args.to}" cannot have asked you — no ask transition "${args.to}" → "${ctx.currentNode}" declared.`,
          );
        }

        const msg = await publishMessage({
          workflowRunId: ctx.runId,
          fromNode: ctx.currentNode,
          toNode: args.to,
          kind: "answer",
          payloadJson: { text: args.answer },
        });
        return textResult(
          `Answer queued (${msg.id}): ${ctx.currentNode} → ${args.to}. Their session will resume with your reply.`,
        );
      },
    ),

    tool(
      "workflow_reject",
      "Reject a prior handoff — send it back for rework. The receiving agent's existing session RESUMES with your rework notes (their Claude context is preserved, unlike a handoff which spawns a fresh session).",
      {
        to: z
          .string()
          .describe(
            "Node slug to send back to (typically the node that handed off to you). Must be a legal reject target.",
          ),
        reason: z
          .string()
          .min(1)
          .describe(
            "What's missing or wrong. Be specific — the other agent will read this verbatim.",
          ),
      },
      async (args) => {
        const loaded = await loadContext(sessionId);
        if ("error" in loaded) return textResult(`Error: ${loaded.error}`);
        const { ctx } = loaded;

        const transition = findTransition(ctx.definition, ctx.currentNode, "reject", args.to);
        if (!transition) {
          const legal = ctx.definition.transitions
            .filter((t) => t.from === ctx.currentNode && t.kind === "reject")
            .map((t) => t.to)
            .join(", ");
          return textResult(
            `Error: no reject transition from "${ctx.currentNode}" to "${args.to}". Legal reject targets: ${legal || "(none)"}.`,
          );
        }

        const msg = await publishMessage({
          workflowRunId: ctx.runId,
          fromNode: ctx.currentNode,
          toNode: args.to,
          kind: "reject",
          payloadJson: { text: args.reason },
        });
        return textResult(
          `Reject queued (${msg.id}): ${ctx.currentNode} → ${args.to}. Their existing session will resume with your rework notes.`,
        );
      },
    ),

    tool(
      "workflow_complete",
      "Mark the workflow run complete. Only call this when the run's goal is fully achieved. After this, no more messages can be published in this run.",
      {
        summary: z
          .string()
          .optional()
          .describe("Optional 1-2 sentence summary of what the run produced (PR link, shipped feature, etc.)."),
      },
      async (args) => {
        const loaded = await loadContext(sessionId);
        if ("error" in loaded) return textResult(`Error: ${loaded.error}`);
        const { ctx } = loaded;

        const transition = ctx.definition.transitions.find(
          (t) => t.from === ctx.currentNode && t.kind === "complete",
        );
        if (!transition) {
          const completers = ctx.definition.transitions
            .filter((t) => t.kind === "complete")
            .map((t) => t.from)
            .join(", ");
          return textResult(
            `Error: node "${ctx.currentNode}" cannot complete the run. Nodes that can complete: ${completers || "(none)"}.`,
          );
        }

        const msg = await publishMessage({
          workflowRunId: ctx.runId,
          fromNode: ctx.currentNode,
          toNode: ctx.currentNode, // unused for complete, but schema requires non-null
          kind: "complete",
          payloadJson: args.summary ? { summary: args.summary } : {},
        });
        return textResult(
          `Complete queued (${msg.id}). The run will close on the next dispatcher tick.`,
        );
      },
    ),
  ];
}

// Re-export the transition kinds list — handy for tests / validation UIs.
export { TRANSITION_KINDS };
