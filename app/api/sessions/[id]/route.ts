import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { loadReadableSession } from "@/lib/auth/authz";
import { removeWorktree } from "@/lib/worktrees/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delete a session, including its worktree (best-effort) and all
 * cascade-linked rows (messages, artifacts, approvals, usage events).
 *
 * Owner-only — team members can't delete a session they don't own.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await loadReadableSession(id, session.userId);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const ownerId = row.ownerId ?? row.userId;
  if (ownerId !== session.userId) {
    return Response.json(
      { error: "Only the session owner can delete it" },
      { status: 403 },
    );
  }

  // Tear down the worktree first so a DB-only success doesn't leak disk.
  if (row.worktreePath) {
    await removeWorktree({
      sourceRepoPath: row.repoPath,
      worktreePath: row.worktreePath,
      worktreeBranch: row.worktreeBranch,
    });
  }

  await db.delete(sessions).where(eq(sessions.id, id));
  return Response.json({ ok: true });
}
