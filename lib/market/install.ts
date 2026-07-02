import "server-only";
import {
  createAgentConfig,
  getAgentConfigBySlug,
} from "@/lib/db/agent-configs";
import {
  findAgentTemplate,
  findTeamTemplate,
  type AgentTemplate,
} from "./catalog";

export interface InstallResult {
  created: string[];
  skipped: string[]; // slug already exists — user config left untouched
}

async function installTemplate(
  userId: string,
  t: AgentTemplate,
  result: InstallResult,
): Promise<void> {
  if (await getAgentConfigBySlug(userId, t.slug)) {
    result.skipped.push(t.slug);
    return;
  }
  await createAgentConfig({
    userId,
    teamId: null,
    slug: t.slug,
    name: t.name,
    systemPrompt: t.systemPrompt,
    model: t.model,
    fallbackModel: t.fallbackModel ?? null,
    allowedTools: null,
    disallowedTools: [],
    includeProjectSkills: t.includeProjectSkills === false ? 0 : 1,
    selectedSkills: null,
    maxTurns: t.maxTurns,
    effort: t.effort,
    maxBudgetUsd: t.maxBudgetUsd ?? null,
    dailyBudgetUsd: null,
    monthlyBudgetUsd: null,
    enableLinearTools: t.enableLinearTools ? 1 : 0,
    enableGithubTools: t.enableGithubTools ? 1 : 0,
    enableAgentTools: t.enableAgentTools ? 1 : 0,
    approvalMode: "none",
    approvalTools: [],
    approvalTimeoutSeconds: 300,
  });
  result.created.push(t.slug);
}

/** Install a single market agent, or a team (members + lead). Idempotent:
 *  existing slugs are skipped, never overwritten. */
export async function installFromMarket(
  userId: string,
  kind: "agent" | "team",
  slug: string,
): Promise<InstallResult> {
  const result: InstallResult = { created: [], skipped: [] };
  if (kind === "agent") {
    const t = findAgentTemplate(slug);
    if (!t) throw new Error(`Unknown market agent "${slug}"`);
    await installTemplate(userId, t, result);
    return result;
  }
  const team = findTeamTemplate(slug);
  if (!team) throw new Error(`Unknown market team "${slug}"`);
  for (const memberSlug of team.members) {
    const member = findAgentTemplate(memberSlug);
    if (!member) throw new Error(`Team references unknown agent "${memberSlug}"`);
    await installTemplate(userId, member, result);
  }
  await installTemplate(userId, team.lead, result);
  return result;
}
