import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import {
  createPoller,
  listVisiblePollers,
} from "@/lib/db/linear-pollers";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  apiKey: z.string().min(1).max(200),
  teamKey: z.string().max(40).nullable().optional(),
  teamId: z.string().nullable().optional(),
  defaultLabel: z.string().min(1).max(80).default("agent"),
  pollIntervalMs: z.number().int().min(15_000).max(3_600_000).default(120_000),
  enabled: z.boolean().default(true),
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await listVisiblePollers(session.userId, myTeamIds);
  return Response.json({ pollers: rows });
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
  const row = await createPoller({
    ownerId: session.userId,
    teamId: d.teamId ?? null,
    name: d.name,
    apiKey: d.apiKey,
    teamKey: d.teamKey ?? null,
    defaultLabel: d.defaultLabel,
    pollIntervalMs: d.pollIntervalMs,
    enabled: d.enabled ? 1 : 0,
  });
  return Response.json({ poller: row });
}
