import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { canUseAgent, getMyTeamIds } from "@/lib/auth/authz";
import { getAgentConfigById } from "@/lib/db/agent-configs";
import {
  createSubscription,
  listVisibleSubscriptions,
} from "@/lib/db/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exact topic ("deploy.finished") or a single trailing ".*" prefix wildcard
// ("deploy.*"). Lowercase dot-separated segments.
const topicPattern = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9]+(\.[a-z0-9]+)*(\.\*)?$/,
    "lowercase dot-segments, optional trailing .*",
  );

const createSchema = z.object({
  agentConfigId: z.string().min(1),
  topicPattern,
  repoId: z.string().nullable().optional(),
  promptTemplate: z.string().max(10_000).nullable().optional(),
  maxPerHour: z.number().int().min(1).max(1000).default(20),
  enabled: z.boolean().default(true),
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await listVisibleSubscriptions(session.userId, myTeamIds);
  return Response.json({ subscriptions: rows });
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

  // The subscriber must be able to use the agent it wires up.
  const agent = await getAgentConfigById(d.agentConfigId);
  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !agent ||
    !canUseAgent(
      session.userId,
      { userId: agent.userId, teamId: agent.teamId },
      new Set(myTeamIds),
    )
  ) {
    return Response.json({ error: "Unknown agent" }, { status: 400 });
  }

  const row = await createSubscription({
    ownerId: session.userId,
    teamId: agent.teamId ?? null,
    agentConfigId: d.agentConfigId,
    topicPattern: d.topicPattern,
    repoId: d.repoId ?? null,
    promptTemplate: d.promptTemplate ?? null,
    maxPerHour: d.maxPerHour,
    enabled: d.enabled ? 1 : 0,
  });
  return Response.json({ subscription: row });
}
