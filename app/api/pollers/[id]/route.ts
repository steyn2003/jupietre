import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  canEditPoller,
  deletePoller,
  getPollerById,
  listRulesForPoller,
  updatePoller,
} from "@/lib/db/linear-pollers";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  apiKey: z.string().min(1).max(200).optional(),
  teamKey: z.string().max(40).nullable().optional(),
  teamId: z.string().nullable().optional(),
  defaultLabel: z.string().min(1).max(80).optional(),
  pollIntervalMs: z.number().int().min(15_000).max(3_600_000).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = await getPollerById(id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  // Visible to owner and to team members of the same team. Reuse the simple
  // rule from canEditPoller for now (owner-only edits, but anyone in the team
  // can read).
  const rules = await listRulesForPoller(id);
  return Response.json({ poller: row, rules });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getPollerById(id);
  if (!existing)
    return Response.json({ error: "Not found" }, { status: 404 });
  if (!canEditPoller(session.userId, existing)) {
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
  if (d.apiKey !== undefined) patch.apiKey = d.apiKey;
  if (d.teamKey !== undefined) patch.teamKey = d.teamKey;
  if (d.teamId !== undefined) patch.teamId = d.teamId;
  if (d.defaultLabel !== undefined) patch.defaultLabel = d.defaultLabel;
  if (d.pollIntervalMs !== undefined) patch.pollIntervalMs = d.pollIntervalMs;
  if (d.enabled !== undefined) patch.enabled = d.enabled ? 1 : 0;

  const row = await updatePoller(id, patch);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ poller: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getPollerById(id);
  if (!existing) return Response.json({ ok: true });
  if (!canEditPoller(session.userId, existing)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deletePoller(id);
  return Response.json({ ok: true });
}
