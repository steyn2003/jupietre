import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  canEditAgent,
  canUseAgent,
  canUseConnection,
  getMyTeamIds,
} from "@/lib/auth/authz";
import { getAgentConfigById } from "@/lib/db/agent-configs";
import {
  createGrant,
  deleteGrant,
  getConnectionById,
  grantsForAgent,
} from "@/lib/db/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ connectionId: z.string().min(1) });

/** Load the agent and confirm the caller may edit it. Returns null on
 *  missing/forbidden so callers can 404/403 uniformly. */
async function requireEditableAgent(userId: string, id: string) {
  const agent = await getAgentConfigById(id);
  if (!agent) return { agent: null, forbidden: false };
  const ok = await canEditAgent(userId, {
    userId: agent.userId,
    teamId: agent.teamId,
  });
  return { agent, forbidden: !ok };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const agent = await getAgentConfigById(id);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });
  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseAgent(
      session.userId,
      { userId: agent.userId, teamId: agent.teamId },
      new Set(myTeamIds),
    )
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const grants = await grantsForAgent(id);
  return Response.json({ connectionIds: grants.map((g) => g.connectionId) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { agent, forbidden } = await requireEditableAgent(session.userId, id);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });
  if (forbidden)
    return Response.json(
      { error: "You can only edit agents you own." },
      { status: 403 },
    );

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid input" }, { status: 400 });

  const connection = await getConnectionById(parsed.data.connectionId);
  if (!connection)
    return Response.json({ error: "Connection not found" }, { status: 404 });

  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseConnection(
      session.userId,
      { ownerId: connection.ownerId, teamId: connection.teamId },
      new Set(myTeamIds),
    )
  ) {
    return Response.json(
      { error: "You cannot grant that connection." },
      { status: 403 },
    );
  }

  const grant = await createGrant(id, connection.id);
  return Response.json({ grant: { connectionId: grant.connectionId } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { agent, forbidden } = await requireEditableAgent(session.userId, id);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });
  if (forbidden)
    return Response.json(
      { error: "You can only edit agents you own." },
      { status: 403 },
    );

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid input" }, { status: 400 });

  await deleteGrant(id, parsed.data.connectionId);
  return Response.json({ ok: true });
}
