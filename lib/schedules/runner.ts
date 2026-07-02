import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentSchedules, repos } from "@/lib/db/schema";
import {
  claimRunDay,
  createSchedule,
  listEnabledSchedules,
  type AgentSchedule,
} from "@/lib/db/schedules";
import { getAgentConfigById, getAgentConfigBySlug } from "@/lib/db/agent-configs";
import { spawnAgentSession, type SpawnRepo } from "@/lib/agent/spawn";

// ────────────────────────────────────────────────────────────────────
// Schedule runner. Replaces the hardcoded scout nightly loop with a generic
// "run agent X daily after hour H with prompt P against repo R (or all
// repos)" engine — schedules are DB rows editable at /schedules. Same
// in-process setInterval pattern as the workflow dispatcher / Linear poller.
// lastRunDay is persisted (claimRunDay), so restarts don't re-fire — an
// improvement over the old scout's in-memory flag.
// ────────────────────────────────────────────────────────────────────

const TICK_MS = Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000);
const INITIAL_DELAY_MS = 15_000;

let started = false;

export function startScheduler(): void {
  if (started) return;
  if (process.env.DISABLE_SCHEDULER === "1") {
    console.log("[schedules] disabled via DISABLE_SCHEDULER=1");
    return;
  }
  started = true;
  console.log(`[schedules] runner starting — tick every ${TICK_MS / 1000}s`);

  void seedScoutSchedule().catch((err) =>
    console.error("[schedules] scout seed failed:", err),
  );

  const tick = () => {
    schedulerTick().catch((err) =>
      console.error("[schedules] tick error:", err),
    );
  };
  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, TICK_MS);
}

function todayKey(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

async function schedulerTick(): Promise<void> {
  const now = new Date();
  const hourNow = now.getHours();
  const weekday = now.getDay();
  const day = todayKey();
  const due = (await listEnabledSchedules()).filter(
    (s) =>
      hourNow >= s.hour &&
      s.lastRunDay !== day &&
      (s.days === null || s.days.includes(weekday)),
  );
  for (const schedule of due) {
    // Claim before spawning so a crash mid-run doesn't re-fire the whole day.
    if (!(await claimRunDay(schedule.id, day))) continue;
    try {
      await runSchedule(schedule);
    } catch (err) {
      console.error(`[schedules] run failed for "${schedule.name}":`, err);
    }
  }
}

/** Fire one schedule now. Exported for the "Run now" button. */
export async function runSchedule(schedule: AgentSchedule): Promise<void> {
  const agent = await getAgentConfigById(schedule.agentConfigId);
  if (!agent) {
    console.warn(
      `[schedules] "${schedule.name}" references a deleted agent — skipping`,
    );
    return;
  }

  const targets: SpawnRepo[] = schedule.repoId
    ? await db
        .select()
        .from(repos)
        .where(eq(repos.id, schedule.repoId))
    : await db
        .select()
        .from(repos)
        .where(eq(repos.userId, schedule.ownerId));

  if (targets.length === 0) {
    console.log(`[schedules] "${schedule.name}" has no target repos — skipped`);
    return;
  }

  for (const repo of targets) {
    const kickoff = [
      `## ⏰ Scheduled run — ${schedule.name} · \`${repo.slug}\``,
      "",
      schedule.prompt,
      "",
      `Default branch is \`${repo.defaultBranch}\`.`,
    ].join("\n");
    try {
      const sessionId = await spawnAgentSession({
        userId: schedule.ownerId,
        teamId: schedule.teamId,
        agentConfigId: agent.id,
        title: `${schedule.name} — ${repo.slug}`,
        source: "schedule",
        repo,
        kickoff,
      });
      console.log(
        `[schedules] "${schedule.name}" started session ${sessionId} on ${repo.slug}`,
      );
    } catch (err) {
      console.error(
        `[schedules] "${schedule.name}" failed to spawn on ${repo.slug}:`,
        err,
      );
    }
  }
}

const SCOUT_DEFAULT_PROMPT =
  "Do a broad sweep for your best small improvements per your standing instructions. Your deliverable is your final report message — do not file tickets. A quiet result (nothing worth flagging) is valid.";

/** One-time migration of the old hardcoded scout nightly: every user who
 *  owns repos and has a scout agent gets a "Nightly scout" schedule row,
 *  unless a schedule already points at their scout agent. Idempotent. */
async function seedScoutSchedule(): Promise<void> {
  const owners = await db
    .selectDistinct({ userId: repos.userId })
    .from(repos);
  for (const { userId } of owners) {
    const scout = await getAgentConfigBySlug(userId, "scout");
    if (!scout) continue;
    const existing = await db
      .select({ id: agentSchedules.id })
      .from(agentSchedules)
      .where(eq(agentSchedules.agentConfigId, scout.id))
      .limit(1);
    if (existing.length > 0) continue;
    await createSchedule({
      ownerId: userId,
      teamId: null,
      name: "Nightly scout",
      agentConfigId: scout.id,
      repoId: null,
      prompt: SCOUT_DEFAULT_PROMPT,
      hour: Number(process.env.SCOUT_HOUR ?? 3),
      enabled: 1,
    });
    console.log(`[schedules] seeded "Nightly scout" for user ${userId}`);
  }
}
