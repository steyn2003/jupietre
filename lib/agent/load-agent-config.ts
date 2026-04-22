import "server-only";
import type { AgentConfig } from "@/lib/db/agent-configs";

export interface BuiltSdkOptions {
  model: string;
  fallbackModel?: string;
  cwd: string;
  /** Omitted when `approvalMode != "none"` so the SDK routes tool calls
   *  through the runner's `canUseTool` callback instead of bypassing. */
  permissionMode?: "bypassPermissions";
  allowDangerouslySkipPermissions?: true;
  systemPrompt: string;
  maxTurns: number;
  effort: "low" | "medium" | "high" | "max";
  settingSources: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  maxBudgetUsd?: number;
}

export function buildSdkOptionsFromConfig(
  c: AgentConfig,
  cwd: string,
): BuiltSdkOptions {
  const enforceApproval = c.approvalMode !== "none";
  const opts: BuiltSdkOptions = {
    model: c.model,
    cwd,
    systemPrompt: c.systemPrompt,
    maxTurns: c.maxTurns,
    effort: c.effort,
    settingSources: c.includeProjectSkills ? ["user", "project"] : ["user"],
  };
  if (!enforceApproval) {
    opts.permissionMode = "bypassPermissions";
    opts.allowDangerouslySkipPermissions = true;
  }
  if (c.fallbackModel) opts.fallbackModel = c.fallbackModel;
  if (c.allowedTools && c.allowedTools.length > 0)
    opts.allowedTools = c.allowedTools;
  if (c.disallowedTools.length > 0) opts.disallowedTools = c.disallowedTools;
  if (c.maxBudgetUsd !== null && c.maxBudgetUsd !== undefined)
    opts.maxBudgetUsd = c.maxBudgetUsd;
  return opts;
}
