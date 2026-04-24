import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  canEditWorkflow,
  canUseWorkflow,
  getMyTeamIds,
} from "@/lib/auth/authz";
import {
  deleteWorkflow,
  getWorkflow,
  updateWorkflow,
} from "@/lib/workflows/runs";
import { workflowDefinitionSchema } from "@/lib/workflows/definitions";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  teamId: z.string().nullable().optional(),
  definition: workflowDefinitionSchema.optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = await getWorkflow(id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseWorkflow(
      session.userId,
      { ownerId: row.ownerId, teamId: row.teamId },
      new Set(myTeamIds),
    )
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ workflow: row });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getWorkflow(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (
    !(await canEditWorkflow(session.userId, {
      ownerId: existing.ownerId,
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

  try {
    const row = await updateWorkflow(existing.ownerId, id, parsed.data);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ workflow: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getWorkflow(id);
  if (!existing) return Response.json({ ok: true });
  if (
    !(await canEditWorkflow(session.userId, {
      ownerId: existing.ownerId,
      teamId: existing.teamId,
    }))
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteWorkflow(existing.ownerId, id);
  return Response.json({ ok: true });
}
