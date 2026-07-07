import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { canEditOwned } from "@/lib/auth/authz";
import {
  deleteSubscription,
  getSubscriptionById,
  updateSubscription,
} from "@/lib/db/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  topicPattern: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(\.[a-z0-9]+)*(\.\*)?$/)
    .optional(),
  repoId: z.string().nullable().optional(),
  promptTemplate: z.string().max(10_000).nullable().optional(),
  maxPerHour: z.number().int().min(1).max(1000).optional(),
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

  const existing = await getSubscriptionById(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (
    !(await canEditOwned(session.userId, {
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
  const d = parsed.data;
  const patch: Record<string, unknown> = {};
  if (d.topicPattern !== undefined) patch.topicPattern = d.topicPattern;
  if (d.repoId !== undefined) patch.repoId = d.repoId;
  if (d.promptTemplate !== undefined) patch.promptTemplate = d.promptTemplate;
  if (d.maxPerHour !== undefined) patch.maxPerHour = d.maxPerHour;
  if (d.enabled !== undefined) patch.enabled = d.enabled ? 1 : 0;

  const row = await updateSubscription(id, patch);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ subscription: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getSubscriptionById(id);
  if (!existing) return Response.json({ ok: true });
  if (
    !(await canEditOwned(session.userId, {
      ownerId: existing.ownerId,
      teamId: existing.teamId,
    }))
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteSubscription(id);
  return Response.json({ ok: true });
}
