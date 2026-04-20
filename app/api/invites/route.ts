import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  buildInviteUrl,
  createInvite,
  listInvitesByInviter,
} from "@/lib/auth/invites";
import { isTeamOwner } from "@/lib/auth/authz";

const createSchema = z.object({
  email: z.string().email(),
  teamId: z.string().nullable().optional(),
  teamRole: z.enum(["owner", "member"]).optional(),
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await listInvitesByInviter(session.userId);
  return Response.json({
    invites: rows.map((r) => ({
      id: r.id,
      email: r.email,
      teamId: r.teamId,
      teamRole: r.teamRole,
      url: buildInviteUrl(r.token),
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
  });
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

  // Only team owners can create team invites.
  if (d.teamId) {
    const owner = await isTeamOwner(session.userId, d.teamId);
    if (!owner)
      return Response.json(
        { error: "Only team owners can invite to this team" },
        { status: 403 },
      );
  }

  const invite = await createInvite({
    email: d.email,
    invitedBy: session.userId,
    teamId: d.teamId ?? null,
    teamRole: d.teamRole ?? "member",
  });

  return Response.json({
    invite: {
      id: invite.id,
      email: invite.email,
      url: buildInviteUrl(invite.token),
      expiresAt: invite.expiresAt.toISOString(),
    },
  });
}
