import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { agentConfigs } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import {
  canEditAgent,
  canUseAgent,
  getMyTeamIds,
} from "@/lib/auth/authz";
import {
  getAgentConfigById,
} from "@/lib/db/agent-configs";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  systemPrompt: z.string().min(1).max(10_000).optional(),
  model: z.string().min(1).optional(),
  fallbackModel: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).optional(),
  includeProjectSkills: z.boolean().optional(),
  selectedSkills: z.array(z.string()).nullable().optional(),
  maxTurns: z.number().int().min(1).max(1000).optional(),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),
  maxBudgetUsd: z.number().int().positive().nullable().optional(),
  dailyBudgetUsd: z.number().int().positive().nullable().optional(),
  monthlyBudgetUsd: z.number().int().positive().nullable().optional(),
  enableLinearTools: z.boolean().optional(),
  enableGithubTools: z.boolean().optional(),
  approvalMode: z.enum(["none", "list", "all"]).optional(),
  approvalTools: z.array(z.string()).optional(),
  approvalTimeoutSeconds: z.number().int().min(5).max(3600).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = await getAgentConfigById(id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseAgent(
      session.userId,
      { userId: row.userId, teamId: row.teamId },
      new Set(myTeamIds),
    )
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ agent: row });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getAgentConfigById(id);
  if (!existing)
    return Response.json({ error: "Not found" }, { status: 404 });
  if (
    !(await canEditAgent(session.userId, {
      userId: existing.userId,
      teamId: existing.teamId,
    }))
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const patch: Record<string, unknown> = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.systemPrompt !== undefined) patch.systemPrompt = d.systemPrompt;
  if (d.model !== undefined) patch.model = d.model;
  if (d.fallbackModel !== undefined) patch.fallbackModel = d.fallbackModel;
  if (d.allowedTools !== undefined) patch.allowedTools = d.allowedTools;
  if (d.disallowedTools !== undefined) patch.disallowedTools = d.disallowedTools;
  if (d.includeProjectSkills !== undefined)
    patch.includeProjectSkills = d.includeProjectSkills ? 1 : 0;
  if (d.selectedSkills !== undefined) patch.selectedSkills = d.selectedSkills;
  if (d.maxTurns !== undefined) patch.maxTurns = d.maxTurns;
  if (d.effort !== undefined) patch.effort = d.effort;
  if (d.maxBudgetUsd !== undefined) patch.maxBudgetUsd = d.maxBudgetUsd;
  if (d.dailyBudgetUsd !== undefined) patch.dailyBudgetUsd = d.dailyBudgetUsd;
  if (d.monthlyBudgetUsd !== undefined)
    patch.monthlyBudgetUsd = d.monthlyBudgetUsd;
  if (d.enableLinearTools !== undefined)
    patch.enableLinearTools = d.enableLinearTools ? 1 : 0;
  if (d.enableGithubTools !== undefined)
    patch.enableGithubTools = d.enableGithubTools ? 1 : 0;
  if (d.approvalMode !== undefined) patch.approvalMode = d.approvalMode;
  if (d.approvalTools !== undefined) patch.approvalTools = d.approvalTools;
  if (d.approvalTimeoutSeconds !== undefined)
    patch.approvalTimeoutSeconds = d.approvalTimeoutSeconds;

  const [row] = await db
    .update(agentConfigs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(agentConfigs.id, id))
    .returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ agent: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getAgentConfigById(id);
  if (!existing) return Response.json({ ok: true });
  if (
    !(await canEditAgent(session.userId, {
      userId: existing.userId,
      teamId: existing.teamId,
    }))
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await db.delete(agentConfigs).where(eq(agentConfigs.id, id));
  return Response.json({ ok: true });
}
