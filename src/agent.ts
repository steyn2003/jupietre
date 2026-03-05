import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { traceAgent } from "./lib/tracing.js";
import type { RoleConfig } from "./roles/index.js";

function formatMessage(message: any): string {
  const base = `[sdk] ${message.type}${
    "subtype" in message ? `:${message.subtype}` : ""
  }`;

  if (message.type === "assistant") {
    const content = message?.message?.content;
    if (!Array.isArray(content)) return base;

    const parts: string[] = [];

    // Collect text (truncated)
    const text = content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    if (text) {
      parts.push(text.length > 200 ? text.slice(0, 200) + "..." : text);
    }

    // Collect tool uses
    const tools = content
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => b.name);
    if (tools.length) {
      parts.push(`tools=[${tools.join(", ")}]`);
    }

    return parts.length ? `${base} | ${parts.join(" | ")}` : base;
  }

  if (message.type === "user") {
    const content = message?.message?.content;
    if (!Array.isArray(content)) return base;

    // Show tool results summary
    const toolResults = content.filter((b: any) => b.type === "tool_result");
    if (toolResults.length) {
      return `${base} | ${toolResults.length} tool result(s)`;
    }
    return base;
  }

  return base;
}

export async function invokeAgent(
  prompt: string,
  role: RoleConfig,
): Promise<string> {
  return traceAgent(
    `${role.name}-invoke`,
    prompt,
    { role: role.name, displayName: role.displayName },
    async () => {
      let resultText = "";

      const toolServer = createSdkMcpServer({
        name: `${role.name}-tools`,
        version: "1.0.0",
        tools: role.tools,
      });

      const agents: Record<string, any> = {};
      if (role.hasDevAgent) {
        agents["dev-agent"] = {
          description:
            "Autonomous coding agent with full file system and shell access. " +
            "Use for implementing features, fixing bugs, refactoring code, " +
            "running tests, and any task that requires reading/writing files or executing commands.",
          prompt:
            "You are an autonomous dev agent. Implement tasks fully. " +
            "Do not ask questions — make reasonable decisions and proceed.\n\n" +
            "## Key Practices\n" +
            "- TDD: Write a failing test first, then minimal code to pass, then refactor. Never skip the red-green cycle.\n" +
            "- Debugging: Find root cause before fixing. Read errors carefully. Trace data flow. One fix at a time.\n" +
            "- Verification: Run tests/build BEFORE claiming done. Evidence before assertions.\n" +
            "- Commits: Small, focused, conventional commit messages (feat:, fix:, refactor:, etc.).\n" +
            "- No debug logs, commented-out code, or unrelated changes.\n" +
            "- Keep it simple: YAGNI, DRY, no over-engineering.",
          model: role.devAgentModel ?? "opus",
        };
      }

      const session = query({
        prompt,
        options: {
          model: role.model,
          cwd: process.env.REPO_DIR || "/data/repo",
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          maxTurns: role.maxTurns,
          systemPrompt: role.systemPrompt,
          stderr: (data: string) => process.stderr.write(data),
          mcpServers: {
            [`${role.name}-tools`]: toolServer,
          },
          agents,
        },
      });

      try {
        for await (const message of session) {
          console.log(formatMessage(message));
          if (message.type === "result") {
            const msg = message as any;
            if (msg.subtype === "success") {
              resultText = msg.result;
            } else {
              resultText = `Error: ${msg.errors?.join("; ") ?? msg.subtype}`;
              console.error(
                `[sdk] result error:`,
                JSON.stringify(msg).slice(0, 500),
              );
            }
          }
        }
      } catch (err) {
        // The SDK throws if the Claude Code process exits with non-zero,
        // even after sending a success result. If we already got a result, use it.
        if (resultText) {
          console.warn(
            `[sdk] Process exited with error after success result, ignoring:`,
            err instanceof Error ? err.message : String(err),
          );
        } else {
          throw err;
        }
      }

      return resultText || "No response";
    },
  );
}
