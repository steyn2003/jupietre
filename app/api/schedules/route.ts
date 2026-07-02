import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { createSchedule, listSchedules } from "@/lib/db/schedules";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  agentConfigId: z.string().min(1),
  /** null = every repo the owner has registered. */
  repoId: z.string().nullable().optional(),
  prompt: z.string().min(1).max(10_000),
  hour: z.number().int().min(0).max(23).default(3),
  /** JS getDay() values (0=Sun … 6=Sat). null/omitted = every day. */
  days: z.array(z.number().int().min(0).max(6)).min(1).nullable().optional(),
  enabled: z.boolean().default(true),
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ schedules: await listSchedules(session.userId) });
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
  const row = await createSchedule({
    ownerId: session.userId,
    teamId: null,
    name: d.name,
    agentConfigId: d.agentConfigId,
    repoId: d.repoId ?? null,
    prompt: d.prompt,
    hour: d.hour,
    days: d.days ?? null,
    enabled: d.enabled ? 1 : 0,
  });
  return Response.json({ schedule: row });
}
