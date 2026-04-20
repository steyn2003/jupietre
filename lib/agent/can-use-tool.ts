import "server-only";
import {
  createApprovalRequest,
  decideApprovalRequest,
} from "@/lib/db/approvals";
import { waitForDecision } from "@/lib/approvals/pubsub";
import type { StreamEvent } from "@/lib/agent/runner-events";

type Persister = (
  sessionId: string,
  kind: "user" | "assistant" | "system" | "tool",
  text: string,
  raw?: unknown,
) => Promise<{ id: string; createdAt: string }>;

type Emitter = (sessionId: string, event: StreamEvent) => void;

interface CanUseToolDeps {
  sessionId: string;
  mode: "none" | "list" | "all";
  gatedTools: string[];
  timeoutSeconds: number;
  emit: Emitter;
  persistMessage: Persister;
}

type PermissionResult =
  | {
      behavior: "allow";
      updatedInput: Record<string, unknown>;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
    };

export function makeCanUseTool(
  deps: CanUseToolDeps,
): (
  toolName: string,
  toolInput: Record<string, unknown>,
  context?: { toolUseID?: string; signal?: AbortSignal },
) => Promise<PermissionResult> {
  const { sessionId, mode, gatedTools, timeoutSeconds, emit, persistMessage } =
    deps;
  const gatedSet = new Set(gatedTools);

  return async function canUseTool(toolName, toolInput, context) {
    if (mode === "none") {
      return { behavior: "allow", updatedInput: toolInput };
    }
    if (mode === "list" && !gatedSet.has(toolName)) {
      return { behavior: "allow", updatedInput: toolInput };
    }

    const req = await createApprovalRequest({
      sessionId,
      toolName,
      toolUseId: context?.toolUseID ?? null,
      args: toolInput,
    });

    emit(sessionId, {
      type: "approval-requested",
      approval: {
        id: req.id,
        toolName,
        args: toolInput,
        timeoutSeconds,
        createdAt: req.createdAt.toISOString(),
      },
    });

    await persistMessage(
      sessionId,
      "system",
      `[approval] ${toolName} → awaiting decision`,
      { approvalId: req.id, args: toolInput },
    );

    const decision = await waitForDecision(req.id, timeoutSeconds * 1000);

    if (decision === "timeout") {
      await decideApprovalRequest(req.id, "timeout");
      emit(sessionId, {
        type: "approval-resolved",
        approval: { id: req.id, status: "timeout" },
      });
      await persistMessage(
        sessionId,
        "system",
        `[approval] ${toolName} → timed out (auto-denied)`,
      );
      return {
        behavior: "deny",
        message: `User did not respond within ${timeoutSeconds}s; tool call auto-denied.`,
      };
    }

    emit(sessionId, {
      type: "approval-resolved",
      approval: {
        id: req.id,
        status: decision.status,
        reason: decision.status === "denied" ? decision.reason ?? null : null,
      },
    });

    if (decision.status === "approved") {
      await persistMessage(
        sessionId,
        "system",
        `[approval] ${toolName} → approved`,
      );
      return { behavior: "allow", updatedInput: toolInput };
    }

    const reasonSuffix =
      decision.status === "denied" && decision.reason
        ? `: ${decision.reason}`
        : "";
    await persistMessage(
      sessionId,
      "system",
      `[approval] ${toolName} → denied${reasonSuffix}`,
    );
    return {
      behavior: "deny",
      message: decision.reason ?? "User denied this tool call.",
    };
  };
}
