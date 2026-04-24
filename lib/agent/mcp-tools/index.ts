import "server-only";
import {
  createSdkMcpServer,
  type McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig } from "@/lib/db/agent-configs";
import { graphPath, hasGraph } from "@/lib/graphify/manager";
import { buildGithubTools } from "./github";
import { buildLinearTools } from "./linear";

export function buildMcpServersForSession(params: {
  sessionId: string;
  repoPath: string;
  /** Absolute path to the base clone. Graph lives at `<clonePath>/graphify-out/`.
   *  Distinct from `repoPath`, which is the per-session worktree. */
  clonePath: string | null;
  agent: AgentConfig;
}): Record<string, McpServerConfig> | undefined {
  const { sessionId, repoPath, clonePath, agent } = params;
  const servers: Record<string, McpServerConfig> = {};

  if (agent.enableLinearTools === 1 && process.env.LINEAR_API_KEY) {
    servers.linear = createSdkMcpServer({
      name: "jupietre-linear",
      version: "1.0.0",
      tools: buildLinearTools(sessionId),
    });
  }

  if (agent.enableGithubTools === 1) {
    servers.github = createSdkMcpServer({
      name: "jupietre-github",
      version: "1.0.0",
      tools: buildGithubTools(sessionId, repoPath),
    });
  }

  // graphify: read-only knowledge-graph queries backed by
  // `<clonePath>/graphify-out/graph.json`. Auto-registered whenever the graph
  // exists — it's strictly additive (no LLM at query time) so we don't gate
  // it behind a per-agent toggle. Build is triggered from lib/repos/manager.
  if (clonePath && hasGraph(clonePath)) {
    servers.graphify = {
      type: "stdio",
      command: "python3",
      args: ["-m", "graphify.serve", graphPath(clonePath)],
    };
  }

  return Object.keys(servers).length > 0 ? servers : undefined;
}
