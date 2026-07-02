import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { deleteSchedule, updateSchedule } from "@/lib/db/schedules";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  agentConfigId: z.string().min(1).optional(),
  repoId: z.string().nullable().optional(),
  prompt: z.string().min(1).max(10_000).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const row = await updateSchedule(session.userId, id, {
    ...(d.name !== undefined ? { name: d.name } : {}),
    ...(d.agentConfigId !== undefined ? { agentConfigId: d.agentConfigId } : {}),
    ...(d.repoId !== undefined ? { repoId: d.repoId } : {}),
    ...(d.prompt !== undefined ? { prompt: d.prompt } : {}),
    ...(d.hour !== undefined ? { hour: d.hour } : {}),
    ...(d.enabled !== undefined ? { enabled: d.enabled ? 1 : 0 } : {}),
  });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ schedule: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteSchedule(session.userId, id);
  return Response.json({ ok: true });
}
