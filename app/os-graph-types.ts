// ────────────────────────────────────────────────────────────────────
// Shared DTO shapes for the /api/os/graph payload, plus small pure
// helpers used by both the Control canvas orchestrator (os-canvas.tsx)
// and the 3D renderer (control-canvas-3d.tsx).
// ────────────────────────────────────────────────────────────────────

export interface AgentDTO {
  id: string;
  slug: string;
  name: string;
  model: string;
  effort: string;
  enableLinearTools: number;
  enableGithubTools: number;
  enableAgentTools: number;
  enableEventTools: number;
  selectedSkillsCount: number | "all";
  maxBudgetUsd: number | null;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  runningCount: number;
  todayCostUsd: number;
  canEdit: boolean;
}

export interface TriggerDTO {
  id: string;
  kind: "linear" | "schedule";
  label: string;
  subLabel: string;
  agentConfigId: string;
  href: string;
}

export interface RepoDTO {
  id: string;
  slug: string;
  githubRepo: string;
}

export interface DelegationEdgeDTO {
  fromAgentId: string;
  toAgentId: string;
  running: boolean;
}

export interface RepoEdgeDTO {
  agentConfigId: string;
  repoId: string;
  running: boolean;
}

export interface ConnectionDTO {
  id: string;
  slug: string;
  name: string;
  kind: "linear" | "github" | "mcp";
  canEdit: boolean;
}

export interface GrantEdgeDTO {
  connectionId: string;
  agentConfigId: string;
}

export interface EventTriggerDTO {
  id: string;
  kind: "subscription" | "webhook";
  label: string;
  subLabel: string;
  agentConfigId: string | null;
  topic: string;
  running: boolean;
}

export interface EmitEdgeDTO {
  agentConfigId: string;
  topic: string;
}

export interface RunningSessionDTO {
  agentConfigId: string;
  source: string;
}

export interface RecentSessionDTO {
  id: string;
  title: string;
  status: string;
  agentConfigId: string;
  updatedAt: string;
}

export interface GraphDTO {
  agents: AgentDTO[];
  triggers: TriggerDTO[];
  repos: RepoDTO[];
  connections: ConnectionDTO[];
  delegationEdges: DelegationEdgeDTO[];
  repoEdges: RepoEdgeDTO[];
  grantEdges: GrantEdgeDTO[];
  eventTriggers: EventTriggerDTO[];
  emitEdges: EmitEdgeDTO[];
  runningSessions: RunningSessionDTO[];
  recentSessions: RecentSessionDTO[];
}

/** Client mirror of lib/db/events.topicMatches — exact topic or a single
 *  trailing ".*" prefix wildcard. Kept local: the server module is server-only. */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern.endsWith(".*")) return topic.startsWith(pattern.slice(0, -1));
  return pattern === topic;
}

export function shortModel(model: string): string {
  return model.replace(/^claude-/, "");
}
