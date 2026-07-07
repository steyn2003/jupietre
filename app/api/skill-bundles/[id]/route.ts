import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  canEditSkillBundle,
  deleteSkillBundle,
  getSkillBundleById,
  updateSkillBundle,
} from "@/lib/db/skill-bundles";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(1_000).optional(),
  skillIds: z.array(z.string()).min(1).max(50).optional(),
  instruction: z.string().max(20_000).optional(),
  teamId: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getSkillBundleById(id);
  if (!existing)
    return Response.json({ error: "Not found" }, { status: 404 });
  if (!canEditSkillBundle(session.userId, existing)) {
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
  if (d.skillIds !== undefined) patch.skillIds = d.skillIds;
  if (d.instruction !== undefined) patch.instruction = d.instruction;
  if (d.teamId !== undefined) patch.teamId = d.teamId;

  const row = await updateSkillBundle(id, patch);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ bundle: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getSkillBundleById(id);
  if (!existing) return Response.json({ ok: true });
  if (!canEditSkillBundle(session.userId, existing)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteSkillBundle(id);
  return Response.json({ ok: true });
}
