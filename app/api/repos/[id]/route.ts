import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { canEditRepo, canUseRepo, getMyTeamIds } from "@/lib/auth/authz";
import { removeRepo } from "@/lib/repos/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = (
    await db.select().from(repos).where(eq(repos.id, id)).limit(1)
  )[0];
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseRepo(
      session.userId,
      { userId: row.userId, teamId: row.teamId },
      new Set(myTeamIds),
    )
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ repo: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = (
    await db.select().from(repos).where(eq(repos.id, id)).limit(1)
  )[0];
  if (!row) return Response.json({ ok: true });
  if (
    !(await canEditRepo(session.userId, {
      userId: row.userId,
      teamId: row.teamId,
    }))
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await removeRepo(row);
  return Response.json({ ok: true });
}
