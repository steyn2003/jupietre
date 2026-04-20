export type MessageKind = "user" | "assistant" | "system" | "tool";

export interface ApprovalRequestedPayload {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  timeoutSeconds: number;
  createdAt: string;
}

export interface ApprovalResolvedPayload {
  id: string;
  status: "approved" | "denied" | "timeout";
  reason?: string | null;
}

export interface StreamEvent {
  type: "message" | "status" | "approval-requested" | "approval-resolved";
  message?: {
    id: string;
    kind: MessageKind;
    text: string;
    createdAt: string;
    indexInSession: number;
  };
  status?: "idle" | "running" | "error";
  approval?: ApprovalRequestedPayload | ApprovalResolvedPayload;
}
