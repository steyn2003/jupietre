import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { agentConfigs } from "./schema";

export type AgentConfig = typeof agentConfigs.$inferSelect;
type NewAgentConfig = typeof agentConfigs.$inferInsert;

/** Own agents only. Kept for built-in seeding; new code should call listVisibleAgentConfigs. */
export async function listAgentConfigs(userId: string): Promise<AgentConfig[]> {
  return db.select().from(agentConfigs).where(eq(agentConfigs.userId, userId));
}

/** Own agents + any team-scoped agent the user has access to. */
export async function listVisibleAgentConfigs(
  userId: string,
  myTeamIds: string[],
): Promise<AgentConfig[]> {
  if (myTeamIds.length === 0) {
    return db
      .select()
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId));
  }
  return db
    .select()
    .from(agentConfigs)
    .where(
      or(
        eq(agentConfigs.userId, userId),
        inArray(agentConfigs.teamId, myTeamIds),
      ),
    );
}

export async function getAgentConfig(
  userId: string,
  id: string,
): Promise<AgentConfig | null> {
  const rows = await db
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.userId, userId), eq(agentConfigs.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAgentConfigBySlug(
  userId: string,
  slug: string,
): Promise<AgentConfig | null> {
  const rows = await db
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.userId, userId), eq(agentConfigs.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAgentConfigById(
  id: string,
): Promise<AgentConfig | null> {
  const rows = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAgentConfig(
  input: Omit<NewAgentConfig, "id" | "createdAt" | "updatedAt">,
): Promise<AgentConfig> {
  const id = nanoid();
  const [row] = await db
    .insert(agentConfigs)
    .values({ ...input, id })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updateAgentConfig(
  userId: string,
  id: string,
  patch: Partial<
    Omit<NewAgentConfig, "id" | "userId" | "slug" | "createdAt">
  >,
): Promise<AgentConfig | null> {
  const [row] = await db
    .update(agentConfigs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(agentConfigs.userId, userId), eq(agentConfigs.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteAgentConfig(
  userId: string,
  id: string,
): Promise<void> {
  await db
    .delete(agentConfigs)
    .where(and(eq(agentConfigs.userId, userId), eq(agentConfigs.id, id)));
}

const PM_SYSTEM_PROMPT = `You are Joseph, an autonomous product manager. Organized, proactive, calm. You prep tickets for the engineering agent.

Turn requests into crisp specs: goals, non-goals, acceptance criteria, edge cases, and a prioritized plan.

When invoked from the Linear poller, follow the workflow injected in the first user message exactly. The deliverable is the Linear ticket itself — description updates via linear_update_issue, comments via linear_add_comment, and state transitions via linear_update_issue_state. Returning a spec only as chat text is a failed run.`;

const ENGINEER_SYSTEM_PROMPT = `You are Pieter, an autonomous software engineer. Competent, direct, low-ego. You ship.

Plan briefly, implement step-by-step, verify with build/tests, ship a PR. Use conventional commits. No debug logs, commented-out code, or unrelated changes.

When invoked from the Linear poller, follow the workflow injected in the first user message exactly. You are not done until the PR exists, linear_add_comment has linked it on the ticket, and linear_update_issue_state has moved the ticket to "In Review".`;

const QA_SYSTEM_PROMPT = `You are Hassan, an autonomous QA reviewer. Fast and decisive. Review PRs by comparing the diff against the ticket's acceptance criteria.

Do NOT modify production code. Do NOT run builds/tests/linters. Approve or reject — be specific about gaps.

When invoked from the Linear poller, follow the workflow injected in the first user message exactly. A reject without BOTH linear_add_comment (gap list) AND linear_update_issue_state (back to "In Development") is a broken handoff — the engineer will never see your feedback.`;

const BUILT_INS: Array<
  Omit<NewAgentConfig, "id" | "userId" | "createdAt" | "updatedAt">
> = [
  {
    slug: "pm",
    name: "PM",
    systemPrompt: PM_SYSTEM_PROMPT,
    model: "claude-opus-4-6",
    fallbackModel: "claude-sonnet-4-6",
    maxTurns: 30,
    effort: "high",
    maxBudgetUsd: 5,
    linearPickup: 1,
    enableLinearTools: 1,
    enableGithubTools: 0,
  },
  {
    slug: "engineer",
    name: "Engineer",
    systemPrompt: ENGINEER_SYSTEM_PROMPT,
    model: "claude-opus-4-6",
    fallbackModel: "claude-sonnet-4-6",
    maxTurns: 200,
    effort: "high",
    maxBudgetUsd: 15,
    linearPickup: 1,
    enableLinearTools: 1,
    enableGithubTools: 1,
  },
  {
    slug: "tester",
    name: "QA",
    systemPrompt: QA_SYSTEM_PROMPT,
    model: "claude-sonnet-4-6",
    fallbackModel: "claude-haiku-4-5-20251001",
    maxTurns: 60,
    effort: "medium",
    maxBudgetUsd: 5,
    linearPickup: 1,
    enableLinearTools: 1,
    enableGithubTools: 0,
  },
];

export async function ensureBuiltInAgentConfigs(userId: string): Promise<void> {
  for (const b of BUILT_INS) {
    const existing = await getAgentConfigBySlug(userId, b.slug);
    if (!existing) {
      await createAgentConfig({ ...b, userId });
    }
  }
}
