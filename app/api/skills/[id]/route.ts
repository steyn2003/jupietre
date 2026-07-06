import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  canEditSkill,
  deleteSkill,
  getSkillById,
  updateSkill,
} from "@/lib/db/skills";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(1_000).optional(),
  body: z.string().min(1).max(200_000).optional(),
  teamId: z.string().nullable().optional(),
  repoId: z.string().nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = await getSkillById(id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ skill: row });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getSkillById(id);
  if (!existing)
    return Response.json({ error: "Not found" }, { status: 404 });
  if (!canEditSkill(session.userId, existing)) {
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
  if (d.description !== undefined) patch.description = d.description;
  if (d.body !== undefined) patch.body = d.body;
  if (d.teamId !== undefined) patch.teamId = d.teamId;
  if (d.repoId !== undefined) patch.repoId = d.repoId;

  const row = await updateSkill(id, patch);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ skill: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getSkillById(id);
  if (!existing) return Response.json({ ok: true });
  if (!canEditSkill(session.userId, existing)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteSkill(id);
  return Response.json({ ok: true });
}
