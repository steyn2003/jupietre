import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { isTeamOwner } from "@/lib/auth/authz";
import { removeMember } from "@/lib/db/teams";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, userId } = await params;
  // Allow self-leave, or team-owner remove.
  const allowed =
    userId === session.userId || (await isTeamOwner(session.userId, id));
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });
  await removeMember(id, userId);
  return Response.json({ ok: true });
}
