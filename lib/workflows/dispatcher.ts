import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { repos, sessions } from "@/lib/db/schema";
import { startTurn } from "@/lib/agent/runner";
import { sendToSession, spawnAgentSession } from "@/lib/agent/spawn";
import {
  parseWorkflowDefinition,
  renderHandoff,
  handoffPayloadSchema,
  type HandoffPayload,
  type WorkflowDefinition,
} from "./definitions";
import {
  countMessagesByKind,
  findMissingAgentIds,
  getRun,
  getWorkflow,
  markMessageDelivered,
  nextPendingMessages,
  sessionForNode,
  setRunCurrentNode,
  setRunStatus,
  type WorkflowMessage,
  type WorkflowRun,
} from "./runs";

// ────────────────────────────────────────────────────────────────────
// In-process poller. Same pattern as lib/linear/poller.ts — polls a DB
// queue every few seconds, processes each pending item, tolerates errors
// by leaving the item for the next tick. No Redis / LISTEN-NOTIFY yet —
// we run single-process like everything else in the app.
// ────────────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS = Number(
  process.env.WORKFLOW_DISPATCHER_INTERVAL_MS ?? 2_000,
);
const INITIAL_DELAY_MS = 5_000;
const BATCH_SIZE = 10;

let started = false;

export function startWorkflowDispatcher(): void {
  if (started) return;
  if (process.env.DISABLE_WORKFLOW_DISPATCHER === "1") {
    console.log(
      "[workflows] dispatcher disabled via DISABLE_WORKFLOW_DISPATCHER=1",
    );
    return;
  }
  started = true;
  console.log(
    `[workflows] dispatcher starting — every ${TICK_INTERVAL_MS / 1000}s`,
  );

  const tick = () => {
    dispatchOnce().catch((err) => {
      console.error("[workflows] dispatch tick error:", err);
    });
  };

  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, TICK_INTERVAL_MS);
}

/**
 * Drain up to BATCH_SIZE pending messages. Exported for tests / manual
 * kicks via an admin route later.
 */
export async function dispatchOnce(): Promise<void> {
  const pending = await nextPendingMessages(BATCH_SIZE);
  for (const msg of pending) {
    try {
      await dispatchMessage(msg);
    } catch (err) {
      // Per-message failures don't poison the batch. The message stays
      // pending and we'll retry on the next tick. If the same message
      // keeps failing, it shows up in the logs and an operator can
      // intervene (delete the row, fix the run, etc.).
      console.error(
        `[workflows] failed to dispatch message ${msg.id} (run=${msg.workflowRunId} kind=${msg.kind} to=${msg.toNode}):`,
        err,
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Single-message routing. Every branch either (a) marks the message
// delivered with a sessionId, (b) marks the run error'd, or (c) throws
// so the outer catch leaves the message pending for retry.
// ────────────────────────────────────────────────────────────────────

async function dispatchMessage(msg: WorkflowMessage): Promise<void> {
  const run = await getRun(msg.workflowRunId);
  if (!run) {
    console.warn(
      `[workflows] message ${msg.id} references missing run ${msg.workflowRunId} — dropping`,
    );
    await markMessageDelivered(msg.id, "");
    return;
  }

  // Terminal runs ignore new messages. This prevents a late-arriving
  // handoff from a since-killed session from restarting a done run.
  if (run.status === "done" || run.status === "error") {
    await markMessageDelivered(msg.id, "");
    return;
  }

  const workflow = await getWorkflow(run.workflowId);
  if (!workflow) {
    await failRun(run, msg, `Workflow ${run.workflowId} not found`);
    return;
  }

  let definition: WorkflowDefinition;
  try {
    definition = parseWorkflowDefinition(workflow.definition);
  } catch (err) {
    await failRun(
      run,
      msg,
      `Workflow definition invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // ── Broken-workflow detection ──
  const missing = await findMissingAgentIds(definition);
  if (missing.length > 0) {
    await failRun(
      run,
      msg,
      `Workflow references deleted agents: ${missing.join(", ")}`,
    );
    return;
  }

  // ── complete: short-circuit before anything else ──
  if (msg.kind === "complete") {
    await setRunStatus(run.id, "done", {
      completedBy: msg.fromNode ?? "(unknown)",
      completedAt: new Date().toISOString(),
    });
    await markMessageDelivered(msg.id, "");
    console.log(`[workflows] run ${run.id} complete (by ${msg.fromNode})`);
    return;
  }

  // ── trigger: validate entry point ──
  if (msg.kind === "trigger") {
    const node = definition.nodes[msg.toNode];
    if (!node) {
      await failRun(run, msg, `Trigger targets unknown node "${msg.toNode}"`);
      return;
    }
    if (!node.canReceive.includes("trigger")) {
      await failRun(
        run,
        msg,
        `Node "${msg.toNode}" does not accept trigger (canReceive=${node.canReceive.join(",")})`,
      );
      return;
    }
  } else {
    // ── all other kinds: must match a declared transition ──
    const legal = definition.transitions.some(
      (t) =>
        t.from === msg.fromNode &&
        t.kind === msg.kind &&
        (t.to ?? null) === msg.toNode,
    );
    if (!legal) {
      await failRun(
        run,
        msg,
        `Illegal transition: ${msg.fromNode ?? "(null)"} --${msg.kind}--> ${msg.toNode}`,
      );
      return;
    }
  }

  // ── Limit enforcement. maxRejects/maxAsks count the delivered history
  //    INCLUDING this message, so the first reject is count=1 etc. We fail
  //    the run when the limit is exceeded on this delivery attempt. ──
  if (msg.kind === "reject" && definition.limits.maxRejects !== undefined) {
    const n = await countMessagesByKind(run.id, "reject");
    if (n > definition.limits.maxRejects) {
      await failRun(
        run,
        msg,
        `Max rejects reached (${definition.limits.maxRejects})`,
      );
      return;
    }
  }
  if (msg.kind === "ask" && definition.limits.maxAsks !== undefined) {
    const n = await countMessagesByKind(run.id, "ask");
    if (n > definition.limits.maxAsks) {
      await failRun(
        run,
        msg,
        `Max asks reached (${definition.limits.maxAsks})`,
      );
      return;
    }
  }
  if (definition.limits.maxBudgetUsd !== undefined) {
    const spent = await sumRunCostUsd(run.id);
    if (spent >= definition.limits.maxBudgetUsd) {
      await failRun(
        run,
        msg,
        `Budget exceeded: $${spent.toFixed(2)} >= $${definition.limits.maxBudgetUsd}`,
      );
      return;
    }
  }

  // ── Routing ──
  const existing = await sessionForNode(run.id, msg.toNode);
  const text = renderMessageText(msg);

  if (msg.kind === "reject" || msg.kind === "answer") {
    // Reject/answer MUST target an existing session — that's the whole
    // point of these kinds: resume the conversation with the right agent.
    if (!existing) {
      await failRun(
        run,
        msg,
        `${msg.kind} targets node "${msg.toNode}" but no session exists for it in this run`,
      );
      return;
    }
    await resumeSession(existing.id, existing.status, text);
    await markMessageDelivered(msg.id, existing.id);
    await setRunStatus(run.id, "running");
    await setRunCurrentNode(run.id, msg.toNode);
    return;
  }

  // trigger / handoff / ask: if a session for this node already exists
  // (unusual, but possible if the DAG loops through the same node), resume
  // it; otherwise spawn a fresh one.
  if (existing) {
    await resumeSession(existing.id, existing.status, text);
    await markMessageDelivered(msg.id, existing.id);
  } else {
    const sessionId = await createSessionForNode({
      run,
      definition,
      nodeSlug: msg.toNode,
    });
    // Mark delivered BEFORE starting the turn so a crash mid-turn
    // doesn't leave the message pending AND a session half-running.
    await markMessageDelivered(msg.id, sessionId);
    void startTurn({ sessionId, userText: text });
  }
  await setRunStatus(run.id, "running");
  await setRunCurrentNode(run.id, msg.toNode);
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

async function failRun(
  run: WorkflowRun,
  msg: WorkflowMessage,
  reason: string,
): Promise<void> {
  console.warn(`[workflows] run ${run.id} → error: ${reason}`);
  await setRunStatus(run.id, "error", {
    error: reason,
    erroredAt: new Date().toISOString(),
    erroredOnMessageId: msg.id,
  });
  await markMessageDelivered(msg.id, "");
}

async function resumeSession(
  sessionId: string,
  currentStatus: string,
  text: string,
): Promise<void> {
  await sendToSession({ sessionId, currentStatus, text });
}

async function createSessionForNode(input: {
  run: WorkflowRun;
  definition: WorkflowDefinition;
  nodeSlug: string;
}): Promise<string> {
  const { run, definition, nodeSlug } = input;
  const node = definition.nodes[nodeSlug];
  if (!node) {
    throw new Error(
      `createSessionForNode: node "${nodeSlug}" not in definition`,
    );
  }

  const repoRow = (
    await db.select().from(repos).where(eq(repos.id, run.repoId)).limit(1)
  )[0];
  if (!repoRow) {
    throw new Error(`createSessionForNode: repo ${run.repoId} not found`);
  }

  // No kickoff here — the caller marks the message delivered BEFORE starting
  // the turn, so a crash mid-dispatch can't leave a pending message AND a
  // half-running session.
  const sessionId = await spawnAgentSession({
    userId: run.ownerId,
    teamId: run.teamId,
    agentConfigId: node.agentConfigId,
    title: `${nodeSlug} (workflow run ${run.id.slice(0, 6)})`,
    source: "workflow",
    repo: repoRow,
    extra: { workflowRunId: run.id, workflowNodeSlug: nodeSlug },
  });

  console.log(
    `[workflows] created session ${sessionId} for run=${run.id} node=${nodeSlug} agent=${node.agentConfigId}`,
  );
  return sessionId;
}

/**
 * Convert a workflow_messages row into the text that becomes the receiving
 * session's next user message. Invalid payloads fall through to a readable
 * fallback — the run can still proceed, the agent just sees "(empty)".
 */
function renderMessageText(msg: WorkflowMessage): string {
  const from = msg.fromNode ?? undefined;
  const to = msg.toNode;
  const payload = msg.payloadJson as Record<string, unknown>;

  switch (msg.kind) {
    case "trigger": {
      const goal =
        typeof payload.goal === "string" ? payload.goal.trim() : "";
      return [
        `## 🚀 Workflow run kickoff → \`${to}\``,
        "",
        goal || "(no goal supplied)",
        "",
        "_You are the first agent in this workflow run. Read the goal, do your work, then hand off to the next node using the `workflow_*` tools (available in a later phase)._",
      ].join("\n");
    }
    case "handoff": {
      const parsed = handoffPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return [
          `## ➡️ Handoff${from ? ` from \`${from}\`` : ""} → \`${to}\``,
          "",
          "_(handoff payload malformed — raw:)_",
          "```json",
          JSON.stringify(payload, null, 2),
          "```",
        ].join("\n");
      }
      return renderHandoff(parsed.data as HandoffPayload, {
        fromNode: from,
        toNode: to,
      });
    }
    case "ask": {
      const text =
        typeof payload.text === "string" ? payload.text.trim() : "";
      return [
        `## ❓ Question from \`${from ?? "(unknown)"}\` → \`${to}\``,
        "",
        text || "(no question text)",
        "",
        "_Reply with \`workflow_answer\` referencing this message._",
      ].join("\n");
    }
    case "answer": {
      const text =
        typeof payload.text === "string" ? payload.text.trim() : "";
      return [
        `## 💬 Answer from \`${from ?? "(unknown)"}\` → \`${to}\``,
        "",
        text || "(no answer text)",
      ].join("\n");
    }
    case "reject": {
      const text =
        typeof payload.text === "string" ? payload.text.trim() : "";
      return [
        `## ❌ Rework requested by \`${from ?? "(unknown)"}\` → \`${to}\``,
        "",
        text || "(no rework notes)",
      ].join("\n");
    }
    case "complete":
      // Never rendered — complete doesn't route to a session.
      return "";
  }
}

async function sumRunCostUsd(runId: string): Promise<number> {
  const costRows = await db
    .select({ totalCostUsd: sessions.totalCostUsd })
    .from(sessions)
    .where(eq(sessions.workflowRunId, runId));
  let total = 0;
  for (const r of costRows) {
    const n = Number.parseFloat(r.totalCostUsd ?? "0");
    if (Number.isFinite(n)) total += n;
  }
  return total;
}
