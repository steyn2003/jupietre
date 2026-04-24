import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getServerSession } from "@/lib/auth/session";
import {
  canUseWorkflow,
  getMyTeamIds,
} from "@/lib/auth/authz";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import {
  getRun,
  getWorkflow,
  listMessagesForRun,
} from "@/lib/workflows/runs";

/**
 * Run detail = the run row + its message log + the sessions spawned for
 * each node. Everything the /workflows/[id]/runs/[runId] UI needs in one
 * round-trip. Messages come back ordered oldest-first so the client can
 * render them as a timeline without re-sorting.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });

  // ACL via the parent workflow — if the user can use the workflow, they
  // can read its runs. Tighter than that (only the run's owner) would
  // surprise team members who kicked off the run together.
  const workflow = await getWorkflow(run.workflowId);
  if (!workflow) return Response.json({ error: "Not found" }, { status: 404 });
  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseWorkflow(
      session.userId,
      { ownerId: workflow.ownerId, teamId: workflow.teamId },
      new Set(myTeamIds),
    )
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const [messages, runSessions] = await Promise.all([
    listMessagesForRun(runId),
    db
      .select({
        id: sessions.id,
        title: sessions.title,
        workflowNodeSlug: sessions.workflowNodeSlug,
        agentConfigId: sessions.agentConfigId,
        status: sessions.status,
        totalCostUsd: sessions.totalCostUsd,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(eq(sessions.workflowRunId, runId)),
  ]);

  return Response.json({
    run,
    workflow: { id: workflow.id, name: workflow.name, slug: workflow.slug },
    messages,
    sessions: runSessions,
  });
}
