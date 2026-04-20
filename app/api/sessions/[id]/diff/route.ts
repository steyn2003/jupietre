import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { loadReadableSession } from "@/lib/auth/authz";
import { getRepoDiff } from "@/lib/git/diff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await loadReadableSession(id, session.userId);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const result = await getRepoDiff(row.worktreePath ?? row.repoPath);
  return Response.json(result);
}
