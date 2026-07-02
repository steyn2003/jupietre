import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { provisionWorktree } from "@/lib/worktrees/manager";
import { queueFollowUp, startTurn } from "@/lib/agent/runner";

/**
 * The one way to spin up an agent session from server-side drivers (scout,
 * schedules, Linear poller, workflow dispatcher, agent_spawn delegation).
 * Replaces the session-insert + worktree-provision boilerplate that used to
 * be copy-pasted across all of them.
 */
export interface SpawnRepo {
  id: string;
  slug: string;
  clonePath: string;
  defaultBranch: string;
}

export async function spawnAgentSession(params: {
  userId: string;
  teamId?: string | null;
  agentConfigId: string;
  title: string;
  source: "ui" | "linear" | "workflow" | "agent" | "schedule";
  /** Bound repo. When set, a per-session worktree is provisioned unless
   *  `worktree: false` (worktree failure falls back to the bare clone). */
  repo?: SpawnRepo | null;
  /** Explicit cwd when there is no repo (voice-ticket-style sessions). */
  repoPath?: string;
  worktree?: boolean;
  /** First user message. When given, the turn starts immediately
   *  (fire-and-forget). Omit to create the session and start it yourself —
   *  the workflow dispatcher needs that ordering. */
  kickoff?: string;
  /** Extra session columns (linearIssueId, parentSessionId, workflowRunId…). */
  extra?: Partial<typeof sessions.$inferInsert>;
}): Promise<string> {
  const { userId, teamId, agentConfigId, title, source, repo, extra } = params;
  const repoPath = repo?.clonePath ?? params.repoPath;
  if (!repoPath) throw new Error("spawnAgentSession: repo or repoPath required");

  const sessionId = nanoid();
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    ownerId: userId,
    teamId: teamId ?? null,
    agentConfigId,
    title,
    repoLabel: repo?.slug ?? null,
    repoPath,
    repoId: repo?.id ?? null,
    source,
    status: "idle",
    ...extra,
  });

  if (repo && params.worktree !== false) {
    try {
      const wt = await provisionWorktree({
        sourceRepoPath: repo.clonePath,
        sessionId,
        baseBranch: repo.defaultBranch,
      });
      await db
        .update(sessions)
        .set({
          worktreePath: wt.worktreePath,
          worktreeBranch: wt.worktreeBranch,
          baseSha: wt.baseSha,
          baseBranch: repo.defaultBranch,
        })
        .where(eq(sessions.id, sessionId));
    } catch (err) {
      console.warn(
        `[spawn] worktree provisioning failed for session ${sessionId}; running against clone:`,
        err,
      );
    }
  }

  // Awaited on purpose: startTurn resolves once the user message is
  // persisted and status is "running" (the heavy work is backgrounded
  // inside it). Guarantees a caller that immediately polls the session —
  // agent_wait right after agent_spawn — never sees a stale "idle".
  if (params.kickoff) await startTurn({ sessionId, userText: params.kickoff });
  return sessionId;
}

/**
 * Deliver text to an existing session: queue as a follow-up when a turn is
 * mid-flight, otherwise start a new turn. (startTurn itself bails if the
 * status read was stale and a turn is actually running.)
 */
export async function sendToSession(params: {
  sessionId: string;
  currentStatus: string;
  text: string;
}): Promise<void> {
  const { sessionId, currentStatus, text } = params;
  if (currentStatus === "running") {
    await queueFollowUp({ sessionId, userText: text });
  } else {
    void startTurn({ sessionId, userText: text });
  }
}
