import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  canEditPoller,
  deleteRule,
  getPollerById,
  getRuleById,
  updateRule,
} from "@/lib/db/linear-pollers";

const patchSchema = z.object({
  mode: z.enum(["pickup", "triage"]).optional(),
  pickupState: z.string().min(1).max(80).optional(),
  inProgressState: z.string().min(1).max(80).nullable().optional(),
  agentConfigId: z.string().min(1).optional(),
  labelOverride: z.string().max(80).nullable().optional(),
  workflowTemplate: z.string().max(20_000).nullable().optional(),
});

async function authzForRule(
  userId: string,
  pollerId: string,
  ruleId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const poller = await getPollerById(pollerId);
  if (!poller) return { ok: false, status: 404, error: "Not found" };
  if (!canEditPoller(userId, poller))
    return { ok: false, status: 403, error: "Forbidden" };
  const rule = await getRuleById(ruleId);
  if (!rule || rule.pollerId !== pollerId)
    return { ok: false, status: 404, error: "Not found" };
  return { ok: true };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, ruleId } = await params;

  const auth = await authzForRule(session.userId, id, ruleId);
  if (!auth.ok)
    return Response.json({ error: auth.error }, { status: auth.status });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const patch: Record<string, unknown> = {};
  if (d.mode !== undefined) {
    patch.mode = d.mode;
    // When flipping a rule into triage, force inProgressState to null —
    // it'd be ignored at runtime anyway, but keeping it makes the row
    // misleading in the UI. Caller can also send inProgressState=null
    // explicitly; either path lands on the same state.
    if (d.mode === "triage" && d.inProgressState === undefined) {
      patch.inProgressState = null;
    }
  }
  if (d.pickupState !== undefined) patch.pickupState = d.pickupState;
  if (d.inProgressState !== undefined)
    patch.inProgressState = d.inProgressState;
  if (d.agentConfigId !== undefined) patch.agentConfigId = d.agentConfigId;
  if (d.labelOverride !== undefined) patch.labelOverride = d.labelOverride;
  if (d.workflowTemplate !== undefined)
    patch.workflowTemplate = d.workflowTemplate;

  const row = await updateRule(ruleId, patch);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ rule: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, ruleId } = await params;

  const auth = await authzForRule(session.userId, id, ruleId);
  if (!auth.ok)
    return Response.json({ error: auth.error }, { status: auth.status });

  await deleteRule(ruleId);
  return Response.json({ ok: true });
}
