import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import { listRecentVisibleEvents } from "@/lib/db/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const limitParam = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 200)
    : 50;

  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await listRecentVisibleEvents(session.userId, myTeamIds, limit);
  return Response.json({ events: rows });
}
