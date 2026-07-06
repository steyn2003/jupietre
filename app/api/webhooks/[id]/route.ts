import type { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { canEditOwned } from "@/lib/auth/authz";
import {
  deleteWebhook,
  getWebhookById,
  isValidTopic,
  updateWebhook,
} from "@/lib/db/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  topic: z
    .string()
    .min(1)
    .max(120)
    .refine(isValidTopic, "lowercase dot-separated segments, no wildcards")
    .optional(),
  enabled: z.boolean().optional(),
  /** Rotate the URL path secret — invalidates the old inbound URL. */
  regenerateKey: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getWebhookById(id);
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
  if (d.name !== undefined) patch.name = d.name;
  if (d.topic !== undefined) patch.topic = d.topic;
  if (d.enabled !== undefined) patch.enabled = d.enabled ? 1 : 0;
  if (d.regenerateKey) patch.key = nanoid(24);

  const row = await updateWebhook(id, patch);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ webhook: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getWebhookById(id);
  if (!existing) return Response.json({ ok: true });
  if (
    !(await canEditOwned(session.userId, {
      ownerId: existing.ownerId,
      teamId: existing.teamId,
    }))
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteWebhook(id);
  return Response.json({ ok: true });
}
