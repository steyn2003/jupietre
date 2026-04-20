import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invites } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { isTeamOwner } from "@/lib/auth/authz";
import { revokeInvite } from "@/lib/auth/invites";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = (
    await db.select().from(invites).where(eq(invites.id, id)).limit(1)
  )[0];
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  // Inviter can revoke their own; team owners can revoke team invites.
  let allowed = row.invitedBy === session.userId;
  if (!allowed && row.teamId) {
    allowed = await isTeamOwner(session.userId, row.teamId);
  }
  if (!allowed)
    return Response.json({ error: "Forbidden" }, { status: 403 });

  await revokeInvite(id);
  return Response.json({ ok: true });
}
