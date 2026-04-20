import "server-only";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig } from "@/lib/db/agent-configs";
import { buildGithubTools } from "./github";
import { buildLinearTools } from "./linear";

export function buildMcpServersForSession(params: {
  sessionId: string;
  repoPath: string;
  agent: AgentConfig;
}): Record<string, ReturnType<typeof createSdkMcpServer>> | undefined {
  const { sessionId, repoPath, agent } = params;
  const servers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};

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

  return Object.keys(servers).length > 0 ? servers : undefined;
}
