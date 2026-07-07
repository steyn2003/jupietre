import "server-only";
import {
  createSdkMcpServer,
  type McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig } from "@/lib/db/agent-configs";
import type { Connection, McpConfig } from "@/lib/db/connections";
import { graphPath, hasGraph } from "@/lib/graphify/manager";
import { buildGithubTools } from "./github";
import { buildLinearTools } from "./linear";
import { buildAgentBuilderTools } from "./agent-builder";
import { buildWorkflowTools } from "./workflow";
import { buildDelegateTools } from "./delegate";
import { buildEventTools } from "./events";

/** MCP server key derived from a connection slug — namespaces its tools as
 *  `mcp__conn_<slug>__<tool>`. Sanitized so a slug can't break the key. */
function mcpServerKeyForSlug(slug: string): string {
  return `conn_${slug.replace(/[^a-zA-Z0-9]+/g, "_")}`;
}

export function buildMcpServersForSession(params: {
  sessionId: string;
  repoPath: string;
  /** Absolute path to the base clone. Graph lives at `<clonePath>/graphify-out/`.
   *  Distinct from `repoPath`, which is the per-session worktree. */
  clonePath: string | null;
  agent: AgentConfig;
  /** Connections granted to this agent (own + team). Loaded alongside the
   *  agent config in the runner and threaded in so this stays sync. Empty /
   *  omitted = legacy behavior driven purely by the enable* flags. */
  grantedConnections?: Connection[];
  /** M12: when set, this session belongs to a workflow run. The workflow_*
   *  MCP tools are only registered in that case — sessions outside a run
   *  shouldn't see them at all. */
  workflowRunId?: string | null;
}): Record<string, McpServerConfig> | undefined {
  const {
    sessionId,
    repoPath,
    clonePath,
    agent,
    grantedConnections = [],
    workflowRunId,
  } = params;
  const servers: Record<string, McpServerConfig> = {};

  const linearGrants = grantedConnections.filter((c) => c.kind === "linear");
  const githubGrants = grantedConnections.filter((c) => c.kind === "github");
  const mcpGrants = grantedConnections.filter((c) => c.kind === "mcp");

  // Linear tools resolve their API key at call-time. A granted linear
  // connection's key takes top precedence (passed in below); otherwise the
  // resolver falls back to the session's poller → any enabled poller → env.
  // Register when the legacy toggle is on OR ≥1 linear connection is granted.
  if (agent.enableLinearTools === 1 || linearGrants.length > 0) {
    const grantedKey =
      linearGrants.length > 0
        ? (linearGrants[0]!.configJson as { apiKey: string }).apiKey
        : undefined;
    servers.linear = createSdkMcpServer({
      name: "jupietre-linear",
      version: "1.0.0",
      tools: buildLinearTools(sessionId, grantedKey),
    });
  }

  // Agent-builder tools are a privileged surface (they create new agents)
  // and are only ever exposed to the built-in agent-builder agent. The
  // create tool also re-checks the running agent's slug at call time as
  // defence in depth, but this is the primary gate.
  if (agent.slug === "agent-builder") {
    servers.agent_builder = createSdkMcpServer({
      name: "jupietre-agent-builder",
      version: "1.0.0",
      tools: buildAgentBuilderTools(sessionId),
    });
  }

  // GitHub tools drive the gh/git CLIs, which read their token from the
  // process env ambiently. A granted token is injected into the subprocess
  // env (preferring it over env GITHUB_TOKEN). Register when the legacy
  // toggle is on OR ≥1 github connection is granted.
  if (agent.enableGithubTools === 1 || githubGrants.length > 0) {
    const grantedToken =
      githubGrants.length > 0
        ? (githubGrants[0]!.configJson as { token: string }).token
        : undefined;
    servers.github = createSdkMcpServer({
      name: "jupietre-github",
      version: "1.0.0",
      tools: buildGithubTools(sessionId, repoPath, grantedToken),
    });
  }

  // External MCP servers — one registered per granted mcp-kind connection,
  // keyed off its slug. stdio launches a subprocess; http hits a remote URL.
  for (const c of mcpGrants) {
    const cfg = c.configJson as McpConfig;
    const key = mcpServerKeyForSlug(c.slug);
    if (cfg.transport === "stdio") {
      servers[key] = { type: "stdio", command: cfg.command, args: cfg.args };
    } else {
      servers[key] = {
        type: "http",
        url: cfg.url,
        ...(cfg.headers ? { headers: cfg.headers } : {}),
      };
    }
  }

  // agent_* delegation tools (spawn/wait/send sub-agent sessions) — the
  // orchestrator surface. Gated per agent config, same as linear/github.
  if (agent.enableAgentTools === 1) {
    servers.agents = createSdkMcpServer({
      name: "jupietre-agents",
      version: "1.0.0",
      tools: buildDelegateTools(sessionId),
    });
  }

  // event_* bus tools (emit / recent). Gated per agent config, same as
  // linear/github/agent.
  if (agent.enableEventTools === 1) {
    servers.events = createSdkMcpServer({
      name: "jupietre-events",
      version: "1.0.0",
      tools: buildEventTools(sessionId),
    });
  }

  if (workflowRunId) {
    servers.workflow = createSdkMcpServer({
      name: "jupietre-workflow",
      version: "1.0.0",
      tools: buildWorkflowTools(sessionId),
    });
  }

  // graphify: read-only knowledge-graph queries backed by
  // `<clonePath>/graphify-out/graph.json`. Auto-registered whenever the graph
  // exists — it's strictly additive (no LLM at query time) so we don't gate
  // it behind a per-agent toggle. The graph is built + committed by the
  // operator on their own machine; the server never runs `graphify update`.
  if (clonePath && hasGraph(clonePath)) {
    servers.graphify = {
      type: "stdio",
      command: "python3",
      args: ["-m", "graphify.serve", graphPath(clonePath)],
    };
  }

  return Object.keys(servers).length > 0 ? servers : undefined;
}
