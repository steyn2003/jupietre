import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import {
  createWebhook,
  isValidTopic,
  listVisibleWebhooks,
} from "@/lib/db/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  topic: z
    .string()
    .min(1)
    .max(120)
    .refine(isValidTopic, "lowercase dot-separated segments, no wildcards"),
  teamId: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await listVisibleWebhooks(session.userId, myTeamIds);
  return Response.json({ webhooks: rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  if (d.teamId) {
    const myTeamIds = await getMyTeamIds(session.userId);
    if (!myTeamIds.includes(d.teamId)) {
      return Response.json(
        { error: "Not a member of that team" },
        { status: 400 },
      );
    }
  }

  const row = await createWebhook({
    ownerId: session.userId,
    teamId: d.teamId ?? null,
    name: d.name,
    topic: d.topic,
    enabled: d.enabled ? 1 : 0,
  });
  return Response.json({ webhook: row });
}
