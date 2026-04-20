import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { toolApprovalRequests } from "./schema";

export type ToolApprovalRequest = typeof toolApprovalRequests.$inferSelect;

export async function createApprovalRequest(input: {
  sessionId: string;
  toolName: string;
  toolUseId?: string | null;
  args: Record<string, unknown>;
}): Promise<ToolApprovalRequest> {
  const id = nanoid();
  const [row] = await db
    .insert(toolApprovalRequests)
    .values({
      id,
      sessionId: input.sessionId,
      toolName: input.toolName,
      toolUseId: input.toolUseId ?? null,
      args: input.args,
    })
    .returning();
  if (!row) throw new Error("Approval insert returned no row");
  return row;
}

export async function getApprovalRequest(
  id: string,
): Promise<ToolApprovalRequest | null> {
  const rows = await db
    .select()
    .from(toolApprovalRequests)
    .where(eq(toolApprovalRequests.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function decideApprovalRequest(
  id: string,
  status: "approved" | "denied" | "timeout",
  reason?: string | null,
): Promise<ToolApprovalRequest | null> {
  const [row] = await db
    .update(toolApprovalRequests)
    .set({
      status,
      reason: reason ?? null,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(toolApprovalRequests.id, id),
        eq(toolApprovalRequests.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listPendingApprovalsForSession(
  sessionId: string,
): Promise<ToolApprovalRequest[]> {
  return db
    .select()
    .from(toolApprovalRequests)
    .where(
      and(
        eq(toolApprovalRequests.sessionId, sessionId),
        eq(toolApprovalRequests.status, "pending"),
      ),
    );
}
