import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { listAllRepos, type Repo } from "@/lib/repos/manager";
import { getAgentConfigBySlug } from "@/lib/db/agent-configs";
import { provisionWorktree } from "@/lib/worktrees/manager";
import { startTurn } from "@/lib/agent/runner";

// ────────────────────────────────────────────────────────────────────
// Nightly improvement scout. Same in-process pattern as the workflow
// dispatcher and Linear poller — a setInterval tick, no external cron.
// Once per calendar day, after SCOUT_HOUR (server-local), it spins up one
// Scout session per registered repo. Each Scout reads the repo, web-searches
// trends, and proposes Linear tickets (approval-gated, so they surface as
// cards in /improvements for the operator to approve in the morning).
// ponytail: server-local clock + once-per-day flag in memory. A restart
// between SCOUT_HOUR and midnight re-fires; acceptable for a nightly tool.
// Set SCOUT_HOUR / SCOUT_INTERVAL_MS / DISABLE_SCOUT to tune.
// ────────────────────────────────────────────────────────────────────

const TICK_MS = Number(process.env.SCOUT_INTERVAL_MS ?? 30 * 60_000);
const RUN_HOUR = Number(process.env.SCOUT_HOUR ?? 3);
const INITIAL_DELAY_MS = 15_000;

let started = false;
let lastRunDay = "";

export function startScout(): void {
  if (started) return;
  if (process.env.DISABLE_SCOUT === "1") {
    console.log("[scout] disabled via DISABLE_SCOUT=1");
    return;
  }
  started = true;
  console.log(
    `[scout] nightly scout starting — fires once daily after ${RUN_HOUR}:00 local`,
  );

  const tick = () => {
    scoutTick().catch((err) => console.error("[scout] tick error:", err));
  };
  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, TICK_MS);
}

function todayKey(): string {
  const n = new Date();
  return `${n.getFullYear()}-${n.getMonth()}-${n.getDate()}`;
}

async function scoutTick(): Promise<void> {
  if (new Date().getHours() < RUN_HOUR) return;
  const day = todayKey();
  if (day === lastRunDay) return;
  lastRunDay = day;
  console.log("[scout] kicking off nightly repo scan");
  // Nightly runs use the optional default focus from the environment.
  await runScout(process.env.SCOUT_FOCUS?.trim() || undefined);
}

/**
 * Run a scout pass over every registered repo. Exported for a manual kick.
 * `focus` is an optional directive ("check for N+1 queries", "find dead
 * code") that Scout makes its primary lens for this pass.
 */
export async function runScout(focus?: string): Promise<void> {
  const repos = await listAllRepos();
  if (repos.length === 0) {
    console.log("[scout] no repos registered — nothing to scan");
    return;
  }
  for (const repo of repos) {
    try {
      await scoutRepo(repo, focus);
    } catch (err) {
      console.error(`[scout] failed to scout repo ${repo.slug}:`, err);
    }
  }
}

async function scoutRepo(repo: Repo, focus?: string): Promise<void> {
  const agent = await getAgentConfigBySlug(repo.userId, "scout");
  if (!agent) {
    console.warn(
      `[scout] no Scout agent for owner of ${repo.slug} — skipping (seed it via /agents)`,
    );
    return;
  }

  const sessionId = nanoid();
  const title = focus
    ? `Scout — ${repo.slug} · ${focus.slice(0, 60)}`
    : `Nightly scout — ${repo.slug}`;
  await db.insert(sessions).values({
    id: sessionId,
    userId: repo.userId,
    ownerId: repo.userId,
    teamId: repo.teamId,
    agentConfigId: agent.id,
    title,
    repoLabel: repo.slug,
    repoPath: repo.clonePath,
    repoId: repo.id,
    source: "ui",
    status: "idle",
  });

  // Per-session worktree, same flow as the dispatcher/poller. Failure falls
  // back to scanning the bare clone (read-only work, so that's harmless).
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
      `[scout] worktree provisioning failed for ${repo.slug}; running against clone:`,
      err,
    );
  }

  const kickoff = [
    `## 🔭 Scout pass — \`${repo.slug}\` (${repo.githubRepo})`,
    "",
    focus
      ? `**Focus for this run:** ${focus}\n\nMake this your primary lens. Go deep on it; you may still flag anything egregious you trip over.`
      : `Do a broad sweep for your best small improvements per your standing instructions.`,
    "",
    `Default branch is \`${repo.defaultBranch}\`. Your deliverable is your final report message — do not file tickets. A quiet result (nothing worth flagging) is valid.`,
  ].join("\n");

  console.log(`[scout] started session ${sessionId} for repo ${repo.slug}`);
  void startTurn({ sessionId, userText: kickoff });
}
