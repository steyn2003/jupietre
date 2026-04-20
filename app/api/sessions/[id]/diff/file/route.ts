import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getServerSession } from "@/lib/auth/session";
import { loadReadableSession } from "@/lib/auth/authz";
import { getFileDiff } from "@/lib/git/file-diff";
import { highlightDiff, highlightFile } from "@/lib/highlight/highlighter";
import { db } from "@/lib/db/client";
import { sessionArtifacts } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await loadReadableSession(id, session.userId);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");
  if (!filePath || filePath.length > 500) {
    return Response.json({ error: "Missing or invalid path" }, { status: 400 });
  }

  const result = await getFileDiff(row.worktreePath ?? row.repoPath, filePath);

  // Highlight in parallel — only when we have content to render.
  const [patchHtml, currentHtml] = await Promise.all([
    result.patch ? highlightDiff(result.patch) : Promise.resolve(""),
    result.currentContents
      ? highlightFile(result.currentContents, result.language)
      : Promise.resolve(""),
  ]);

  // Cross-ref to assistant turns: file_change artifacts whose externalId
  // matches the file path. We pull turn index from raw.indexInSession when
  // the runner included it, otherwise fall back to "earliest of all".
  const artifacts = await db
    .select({
      raw: sessionArtifacts.raw,
      createdAt: sessionArtifacts.createdAt,
    })
    .from(sessionArtifacts)
    .where(
      and(
        eq(sessionArtifacts.sessionId, id),
        eq(sessionArtifacts.kind, "file_change"),
        eq(sessionArtifacts.externalId, filePath),
      ),
    );
  const turnSet = new Set<number>();
  for (const a of artifacts) {
    const raw = a.raw as { indexInSession?: number } | null;
    if (typeof raw?.indexInSession === "number") {
      turnSet.add(raw.indexInSession);
    }
  }
  const assistantTurns = Array.from(turnSet).sort((a, b) => a - b);

  return Response.json({
    ...result,
    patchHtml,
    currentHtml,
    assistantTurns,
  });
}
