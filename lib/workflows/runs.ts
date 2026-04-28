import "server-only";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  agentConfigs,
  sessions,
  workflowMessages,
  workflowRuns,
  workflows,
} from "@/lib/db/schema";
import { getAgentConfigBySlug } from "@/lib/db/agent-configs";
import {
  buildPmEngQaDefinition,
  parseWorkflowDefinition,
  PM_ENG_QA_NAME,
  PM_ENG_QA_SLUG,
  referencedAgentIds,
  type MessageKind,
  type WorkflowDefinition,
} from "./definitions";

export type Workflow = typeof workflows.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type WorkflowMessage = typeof workflowMessages.$inferSelect;

type NewWorkflow = typeof workflows.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// Workflows (definitions) — CRUD
// ────────────────────────────────────────────────────────────────────

/**
 * Workflows the user owns OR that are team-scoped to one of their teams.
 * Mirrors listVisibleAgentConfigs in lib/db/agent-configs.ts.
 */
export async function listVisibleWorkflows(
  userId: string,
  myTeamIds: string[],
): Promise<Workflow[]> {
  if (myTeamIds.length === 0) {
    return db.select().from(workflows).where(eq(workflows.ownerId, userId));
  }
  return db
    .select()
    .from(workflows)
    .where(
      or(
        eq(workflows.ownerId, userId),
        inArray(workflows.teamId, myTeamIds),
      ),
    );
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  const rows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getWorkflowBySlug(
  ownerId: string,
  slug: string,
): Promise<Workflow | null> {
  const rows = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.ownerId, ownerId), eq(workflows.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createWorkflow(input: {
  ownerId: string;
  teamId?: string | null;
  slug: string;
  name: string;
  definition: WorkflowDefinition;
}): Promise<Workflow> {
  // Re-parse so callers can't bypass validation by type-asserting.
  const validated = parseWorkflowDefinition(input.definition);
  const id = nanoid();
  const row: NewWorkflow = {
    id,
    ownerId: input.ownerId,
    teamId: input.teamId ?? null,
    slug: input.slug,
    name: input.name,
    definition: validated as unknown as Record<string, unknown>,
  };
  const [created] = await db.insert(workflows).values(row).returning();
  if (!created) throw new Error("Insert returned no row");
  return created;
}

export async function updateWorkflow(
  ownerId: string,
  id: string,
  patch: {
    name?: string;
    teamId?: string | null;
    definition?: WorkflowDefinition;
  },
): Promise<Workflow | null> {
  const values: Partial<NewWorkflow> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.teamId !== undefined) values.teamId = patch.teamId;
  if (patch.definition !== undefined) {
    const validated = parseWorkflowDefinition(patch.definition);
    values.definition = validated as unknown as Record<string, unknown>;
  }
  const [row] = await db
    .update(workflows)
    .set(values)
    .where(and(eq(workflows.ownerId, ownerId), eq(workflows.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteWorkflow(
  ownerId: string,
  id: string,
): Promise<void> {
  await db
    .delete(workflows)
    .where(and(eq(workflows.ownerId, ownerId), eq(workflows.id, id)));
}

/**
 * Read-and-parse helper: fetch a workflow and return its validated definition.
 * Throws if the stored JSON is somehow no longer valid (e.g. the schema got
 * stricter in a later version). Callers should treat the throw as "workflow
 * is broken, surface an error to the user" rather than a 500.
 */
export async function getWorkflowDefinition(
  id: string,
): Promise<{ workflow: Workflow; definition: WorkflowDefinition } | null> {
  const workflow = await getWorkflow(id);
  if (!workflow) return null;
  const definition = parseWorkflowDefinition(workflow.definition);
  return { workflow, definition };
}

// ────────────────────────────────────────────────────────────────────
// Workflow runs
// ────────────────────────────────────────────────────────────────────

export async function createRun(input: {
  workflowId: string;
  repoId: string;
  ownerId: string;
  teamId?: string | null;
  currentNode: string;
  goal: string;
}): Promise<WorkflowRun> {
  const id = nanoid();
  const [row] = await db
    .insert(workflowRuns)
    .values({
      id,
      workflowId: input.workflowId,
      repoId: input.repoId,
      ownerId: input.ownerId,
      teamId: input.teamId ?? null,
      currentNode: input.currentNode,
      contextJson: { goal: input.goal },
      status: "running",
    })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function getRun(id: string): Promise<WorkflowRun | null> {
  const rows = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRunsForWorkflow(
  workflowId: string,
): Promise<WorkflowRun[]> {
  return db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.createdAt));
}

export async function listRunsForOwner(
  ownerId: string,
): Promise<WorkflowRun[]> {
  return db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.ownerId, ownerId))
    .orderBy(desc(workflowRuns.createdAt));
}

/**
 * All runs the user can see — gated by *workflow* ACL (own + team) so
 * teammates can see runs against shared workflows even if they didn't
 * start them. Returns the run row joined with the workflow's name + slug
 * for display.
 */
export async function listVisibleRuns(
  userId: string,
  myTeamIds: string[],
  limit = 100,
): Promise<
  Array<
    WorkflowRun & {
      workflowName: string;
      workflowSlug: string;
    }
  >
> {
  const condition =
    myTeamIds.length === 0
      ? eq(workflows.ownerId, userId)
      : or(
          eq(workflows.ownerId, userId),
          inArray(workflows.teamId, myTeamIds),
        );
  const rows = await db
    .select({
      run: workflowRuns,
      workflowName: workflows.name,
      workflowSlug: workflows.slug,
    })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflowRuns.workflowId, workflows.id))
    .where(condition)
    .orderBy(desc(workflowRuns.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r.run,
    workflowName: r.workflowName,
    workflowSlug: r.workflowSlug,
  }));
}

export async function setRunStatus(
  id: string,
  status: WorkflowRun["status"],
  extraContext?: Record<string, unknown>,
): Promise<void> {
  const values: {
    status: WorkflowRun["status"];
    updatedAt: Date;
    contextJson?: Record<string, unknown>;
  } = {
    status,
    updatedAt: new Date(),
  };
  if (extraContext) {
    const run = await getRun(id);
    if (run) {
      values.contextJson = { ...(run.contextJson ?? {}), ...extraContext };
    }
  }
  await db.update(workflowRuns).set(values).where(eq(workflowRuns.id, id));
}

export async function setRunCurrentNode(
  id: string,
  nodeSlug: string,
): Promise<void> {
  await db
    .update(workflowRuns)
    .set({ currentNode: nodeSlug, updatedAt: new Date() })
    .where(eq(workflowRuns.id, id));
}

// ────────────────────────────────────────────────────────────────────
// Workflow messages (inter-agent mailbox + event log)
// ────────────────────────────────────────────────────────────────────

export async function publishMessage(input: {
  workflowRunId: string;
  fromNode: string | null;
  toNode: string;
  kind: MessageKind;
  payloadJson: Record<string, unknown>;
}): Promise<WorkflowMessage> {
  const id = nanoid();
  const [row] = await db
    .insert(workflowMessages)
    .values({
      id,
      workflowRunId: input.workflowRunId,
      fromNode: input.fromNode,
      toNode: input.toNode,
      kind: input.kind,
      payloadJson: input.payloadJson,
      status: "pending",
    })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

/**
 * Read the next pending message across all runs, oldest first. The dispatcher
 * polls this on a ~2s tick. No SELECT FOR UPDATE SKIP LOCKED yet — single
 * dispatcher process, so a plain ordered read is enough and matches the
 * pattern in lib/linear/poller.ts. Promote to skip-locked if we ever add a
 * second dispatcher instance.
 */
export async function nextPendingMessages(
  limit = 10,
): Promise<WorkflowMessage[]> {
  return db
    .select()
    .from(workflowMessages)
    .where(eq(workflowMessages.status, "pending"))
    .orderBy(asc(workflowMessages.createdAt))
    .limit(limit);
}

export async function listMessagesForRun(
  workflowRunId: string,
): Promise<WorkflowMessage[]> {
  return db
    .select()
    .from(workflowMessages)
    .where(eq(workflowMessages.workflowRunId, workflowRunId))
    .orderBy(asc(workflowMessages.createdAt));
}

export async function markMessageDelivered(
  id: string,
  sessionId: string,
): Promise<void> {
  await db
    .update(workflowMessages)
    .set({
      status: "delivered",
      sessionId,
      deliveredAt: new Date(),
    })
    .where(eq(workflowMessages.id, id));
}

export async function markMessageConsumed(id: string): Promise<void> {
  await db
    .update(workflowMessages)
    .set({ status: "consumed" })
    .where(eq(workflowMessages.id, id));
}

/**
 * Count messages of a given kind already sent in a run. Used by the
 * dispatcher to enforce `limits.maxRejects` / `limits.maxAsks`.
 */
export async function countMessagesByKind(
  workflowRunId: string,
  kind: MessageKind,
): Promise<number> {
  const rows = await db
    .select({ id: workflowMessages.id })
    .from(workflowMessages)
    .where(
      and(
        eq(workflowMessages.workflowRunId, workflowRunId),
        eq(workflowMessages.kind, kind),
      ),
    );
  return rows.length;
}

// ────────────────────────────────────────────────────────────────────
// Session ↔ node mapping — used by the dispatcher to decide
// "new session for this node, or resume the one that already exists?"
// ────────────────────────────────────────────────────────────────────

export async function sessionForNode(
  workflowRunId: string,
  nodeSlug: string,
): Promise<{ id: string; status: string; sdkSessionId: string | null } | null> {
  const rows = await db
    .select({
      id: sessions.id,
      status: sessions.status,
      sdkSessionId: sessions.sdkSessionId,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.workflowRunId, workflowRunId),
        eq(sessions.workflowNodeSlug, nodeSlug),
      ),
    )
    .orderBy(desc(sessions.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSessionsForRun(
  workflowRunId: string,
): Promise<Array<{ id: string; workflowNodeSlug: string | null; createdAt: Date }>> {
  return db
    .select({
      id: sessions.id,
      workflowNodeSlug: sessions.workflowNodeSlug,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(eq(sessions.workflowRunId, workflowRunId))
    .orderBy(asc(sessions.createdAt));
}

// ────────────────────────────────────────────────────────────────────
// Built-in seeder — called from lib/auth/bootstrap.ts after agents are
// seeded. Idempotent: skips when the workflow already exists for this
// owner, and skips quietly if any of the three referenced agents is
// missing (the user may have renamed/deleted built-in agents).
// ────────────────────────────────────────────────────────────────────

export async function ensureBuiltInWorkflows(userId: string): Promise<void> {
  const existing = await getWorkflowBySlug(userId, PM_ENG_QA_SLUG);
  if (existing) return;

  const [pm, engineer, tester] = await Promise.all([
    getAgentConfigBySlug(userId, "pm"),
    getAgentConfigBySlug(userId, "engineer"),
    getAgentConfigBySlug(userId, "tester"),
  ]);
  if (!pm || !engineer || !tester) {
    console.log(
      `[workflows] Skipping pm-eng-qa seed for ${userId} — missing one of the three built-in agents (pm/engineer/tester).`,
    );
    return;
  }

  const definition = buildPmEngQaDefinition({
    pm: pm.id,
    engineer: engineer.id,
    tester: tester.id,
  });

  await createWorkflow({
    ownerId: userId,
    slug: PM_ENG_QA_SLUG,
    name: PM_ENG_QA_NAME,
    definition,
  });
  console.log(`[workflows] Seeded pm-eng-qa for user ${userId}`);
}

// ────────────────────────────────────────────────────────────────────
// Broken-workflow detection — the dispatcher calls this before delivering
// the first message of a run. If any referenced agent has been deleted
// since the workflow was saved, we mark the run `error` with a readable
// reason instead of silently failing mid-dispatch.
// ────────────────────────────────────────────────────────────────────

export async function findMissingAgentIds(
  def: WorkflowDefinition,
): Promise<string[]> {
  const ids = referencedAgentIds(def);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: agentConfigs.id })
    .from(agentConfigs)
    .where(inArray(agentConfigs.id, ids));
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !found.has(id));
}
