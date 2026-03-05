import { readFileSync } from "node:fs";
import { join } from "node:path";
import { role as pmRole } from "./pm.js";
import { role as engineerRole } from "./engineer.js";
import { role as testerRole } from "./qa.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface RoleConfig {
  name: string;
  displayName: string;
  systemPrompt: string;
  tools: any[];
  /** Linear issue filter for the poller */
  pollerFilter: {
    /** Only pick up issues with this label (undefined = no label check) */
    label?: string;
    /** Pick up issues in this workflow state name (or multiple states) */
    stateName: string | string[];
  };
  /** State to move issue to when work begins */
  inProgressState: string;
  /** State to move issue to when work is complete */
  doneState: string;
  /** Whether the poller should auto-move to doneState after the agent completes (default: true).
   *  Set to false when the agent manages its own state transitions (e.g. PM may move to "Waiting"). */
  autoMoveToDone?: boolean;
  /** Whether this role has the dev-agent subagent */
  hasDevAgent: boolean;
  /** Max turns for the agent session */
  maxTurns: number;
  /** Model to use for this role's main agent */
  model: string;
  /** Model to use for the dev-agent subagent (if hasDevAgent) */
  devAgentModel?: string;
}

const roles: Record<string, RoleConfig> = {
  pm: pmRole,
  engineer: engineerRole,
  tester: testerRole,
};

function readProjectContext(): string {
  const repoDir = process.env.REPO_DIR || "/data/repo";
  try {
    return readFileSync(join(repoDir, "CLAUDE.md"), "utf-8").trim();
  } catch {
    console.warn(`No CLAUDE.md found in ${repoDir}, skipping project context injection`);
    return "";
  }
}

export function loadRole(): RoleConfig {
  const name = process.env.AGENT_ROLE ?? "engineer";
  const role = roles[name];
  if (!role) throw new Error(`Unknown AGENT_ROLE: ${name}. Available: ${Object.keys(roles).join(", ")}`);

  const projectContext = readProjectContext();
  if (projectContext) {
    role.systemPrompt = role.systemPrompt.replace(
      "{PROJECT_CONTEXT}",
      `## Project Context\n${projectContext}`,
    );
  } else {
    role.systemPrompt = role.systemPrompt.replace("{PROJECT_CONTEXT}\n\n", "");
    role.systemPrompt = role.systemPrompt.replace("{PROJECT_CONTEXT}", "");
  }

  return role;
}
