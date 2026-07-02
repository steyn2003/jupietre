import "server-only";
import { listAllRepos, type Repo } from "@/lib/repos/manager";
import { getAgentConfigBySlug } from "@/lib/db/agent-configs";
import { spawnAgentSession } from "@/lib/agent/spawn";

// ────────────────────────────────────────────────────────────────────
// Manual scout kick. The nightly cadence moved to the generic schedule
// runner (lib/schedules/runner.ts seeds a "Nightly scout" row per repo
// owner). This module only keeps the on-demand sweep used by
// POST /api/scout/run and the /improvements "Run scout" button, because a
// manual run carries an operator-supplied focus the schedule row doesn't.
// ────────────────────────────────────────────────────────────────────

/**
 * Run a scout pass over every registered repo. `focus` is an optional
 * directive ("check for N+1 queries", "find dead code") that Scout makes its
 * primary lens for this pass.
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

  const kickoff = [
    `## 🔭 Scout pass — \`${repo.slug}\` (${repo.githubRepo})`,
    "",
    focus
      ? `**Focus for this run:** ${focus}\n\nMake this your primary lens. Go deep on it; you may still flag anything egregious you trip over.`
      : `Do a broad sweep for your best small improvements per your standing instructions.`,
    "",
    `Default branch is \`${repo.defaultBranch}\`. Your deliverable is your final report message — do not file tickets. A quiet result (nothing worth flagging) is valid.`,
  ].join("\n");

  const sessionId = await spawnAgentSession({
    userId: repo.userId,
    teamId: repo.teamId,
    agentConfigId: agent.id,
    title: focus
      ? `Scout — ${repo.slug} · ${focus.slice(0, 60)}`
      : `Nightly scout — ${repo.slug}`,
    source: "ui",
    repo,
    kickoff,
  });
  console.log(`[scout] started session ${sessionId} for repo ${repo.slug}`);
}
