import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { loadReadableSession } from "@/lib/auth/authz";
import { listArtifactsForSession } from "@/lib/db/artifacts";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const owned = await loadReadableSession(id, session.userId);
  if (!owned) return Response.json({ error: "Not found" }, { status: 404 });

  const rows = await listArtifactsForSession(id);
  return Response.json({
    artifacts: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      url: r.url,
      summary: r.summary,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
