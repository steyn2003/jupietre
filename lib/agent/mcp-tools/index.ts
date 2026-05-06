import "server-only";
import {
  createSdkMcpServer,
  type McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig } from "@/lib/db/agent-configs";
import { graphPath, hasGraph } from "@/lib/graphify/manager";
import { buildGithubTools } from "./github";
import { buildLinearTools } from "./linear";
import { buildAgentBuilderTools } from "./agent-builder";
import { buildWorkflowTools } from "./workflow";

export function buildMcpServersForSession(params: {
  sessionId: string;
  repoPath: string;
  /** Absolute path to the base clone. Graph lives at `<clonePath>/graphify-out/`.
   *  Distinct from `repoPath`, which is the per-session worktree. */
  clonePath: string | null;
  agent: AgentConfig;
  /** M12: when set, this session belongs to a workflow run. The workflow_*
   *  MCP tools are only registered in that case — sessions outside a run
   *  shouldn't see them at all. */
  workflowRunId?: string | null;
}): Record<string, McpServerConfig> | undefined {
  const { sessionId, repoPath, clonePath, agent, workflowRunId } = params;
  const servers: Record<string, McpServerConfig> = {};

  // Linear tools resolve their API key at call-time — first from the
  // session's originating poller, then any enabled poller, then env. So we
  // register the server whenever the agent toggle is on and let the tool
  // body throw a descriptive error if no key is configured anywhere.
  if (agent.enableLinearTools === 1) {
    servers.linear = createSdkMcpServer({
      name: "jupietre-linear",
      version: "1.0.0",
      tools: buildLinearTools(sessionId),
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

  if (agent.enableGithubTools === 1) {
    servers.github = createSdkMcpServer({
      name: "jupietre-github",
      version: "1.0.0",
      tools: buildGithubTools(sessionId, repoPath),
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
