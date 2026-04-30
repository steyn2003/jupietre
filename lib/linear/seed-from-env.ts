import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { listAgentConfigs } from "@/lib/db/agent-configs";
import {
  createPoller,
  createRule,
  pollersTableHasRows,
} from "@/lib/db/linear-pollers";
import { defaultWorkflowForSlug } from "./default-workflows";

function envKeyForSlug(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

/**
 * Migrate the legacy env-driven configuration into the new `linear_pollers` +
 * `linear_poller_rules` tables on first boot. No-ops if any poller already
 * exists, or if no LINEAR_API_KEY is set.
 *
 * Mapping:
 *   LINEAR_API_KEY                              → poller.apiKey
 *   POLL_INTERVAL_MS                            → poller.pollIntervalMs
 *   "agent" label (was hardcoded)               → poller.defaultLabel
 *   For each agent_configs row whose slug had
 *   <SLUG>_PICKUP_STATE / <SLUG>_IN_PROGRESS_STATE
 *   set in env (or QA_* legacy aliases for slug "tester"):
 *                                               → one rule per agent
 *
 * After the seed runs once, env vars are no longer consulted by the poller —
 * the operator manages everything in /pollers.
 */
export async function seedFromEnvIfEmpty(): Promise<void> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return;
  if (await pollersTableHasRows()) return;

  // Find an admin user to own the seeded poller — same heuristic the legacy
  // poller used (`findAdminUserId`).
  const adminRow = (
    await db
      .select({ id: users.id })
      .from(users)
      .orderBy(users.createdAt)
      .limit(1)
  )[0];
  if (!adminRow) {
    console.warn(
      "[linear] seed-from-env: no admin user yet — skipping (will retry on next boot)",
    );
    return;
  }

  const intervalMs = Number(process.env.POLL_INTERVAL_MS) || 120_000;
  const poller = await createPoller({
    ownerId: adminRow.id,
    teamId: null,
    name: "Default (migrated from env)",
    apiKey,
    teamKey: null,
    defaultLabel: "agent",
    pollIntervalMs: intervalMs,
    enabled: 1,
  });

  // Walk admin's agents — the legacy poller used `findAdminUserId` then
  // `listAgentConfigs(userId)`, so we mirror that scope.
  const agents = await listAgentConfigs(adminRow.id);
  let ruleCount = 0;
  for (const agent of agents) {
    const envBase = envKeyForSlug(agent.slug);
    const pickupKey =
      agent.slug === "tester" ? "QA_PICKUP_STATE" : `${envBase}_PICKUP_STATE`;
    const inProgressKey =
      agent.slug === "tester"
        ? "QA_IN_PROGRESS_STATE"
        : `${envBase}_IN_PROGRESS_STATE`;
    const pickup = process.env[pickupKey];
    const inProgress = process.env[inProgressKey];
    if (!pickup || !inProgress) continue;

    await createRule({
      pollerId: poller.id,
      pickupState: pickup,
      inProgressState: inProgress,
      agentConfigId: agent.id,
      labelOverride: null,
      // Snapshot the slug-keyed default into the rule so future edits live in
      // one place (the rule), not split between code and DB.
      workflowTemplate: defaultWorkflowForSlug(agent.slug),
    });
    ruleCount++;
  }

  console.log(
    `[linear] seeded poller "${poller.name}" with ${ruleCount} rule(s) from env. ` +
      `LINEAR_API_KEY / POLL_INTERVAL_MS / <SLUG>_PICKUP_STATE env vars are no longer consulted.`,
  );
}
