import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  canUseRepo,
  canUseWorkflow,
  getMyTeamIds,
} from "@/lib/auth/authz";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import {
  createRun,
  findMissingAgentIds,
  getWorkflowDefinition,
  listRunsForWorkflow,
  publishMessage,
} from "@/lib/workflows/runs";

const startSchema = z.object({
  repoId: z.string().min(1),
  goal: z.string().min(1).max(8000),
  teamId: z.string().nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const loaded = await getWorkflowDefinition(id);
  if (!loaded) return Response.json({ error: "Not found" }, { status: 404 });
  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseWorkflow(
      session.userId,
      { ownerId: loaded.workflow.ownerId, teamId: loaded.workflow.teamId },
      new Set(myTeamIds),
    )
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const runs = await listRunsForWorkflow(id);
  return Response.json({ runs });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const loaded = await getWorkflowDefinition(id);
  if (!loaded) return Response.json({ error: "Not found" }, { status: 404 });
  const myTeamIds = await getMyTeamIds(session.userId);
  const myTeamSet = new Set(myTeamIds);

  if (
    !canUseWorkflow(
      session.userId,
      { ownerId: loaded.workflow.ownerId, teamId: loaded.workflow.teamId },
      myTeamSet,
    )
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = startSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // Repo ACL
  const repoRow = (
    await db.select().from(repos).where(eq(repos.id, d.repoId)).limit(1)
  )[0];
  if (!repoRow) {
    return Response.json({ error: "Repo not found" }, { status: 400 });
  }
  if (
    !canUseRepo(
      session.userId,
      { userId: repoRow.userId, teamId: repoRow.teamId },
      myTeamSet,
    )
  ) {
    return Response.json({ error: "Repo not accessible" }, { status: 403 });
  }

  // Broken-workflow detection: refuse to start if any referenced agent
  // was deleted since the workflow was saved. Same check the dispatcher
  // runs per-message; doing it upfront surfaces the error immediately
  // instead of inside a cryptic run-error state.
  const missing = await findMissingAgentIds(loaded.definition);
  if (missing.length > 0) {
    return Response.json(
      {
        error: `Workflow references deleted agents: ${missing.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Pick the entry-point node. The zod validator guarantees at least one
  // node has "trigger" in canReceive; if several do, first declared wins.
  const entryNode = Object.entries(loaded.definition.nodes).find(([, n]) =>
    n.canReceive.includes("trigger"),
  )?.[0];
  if (!entryNode) {
    // Shouldn't happen — the validator enforces this — but defensive.
    return Response.json(
      { error: "Workflow has no trigger entry point" },
      { status: 400 },
    );
  }

  const run = await createRun({
    workflowId: id,
    repoId: d.repoId,
    ownerId: session.userId,
    teamId: d.teamId ?? loaded.workflow.teamId ?? null,
    currentNode: entryNode,
    goal: d.goal,
  });

  await publishMessage({
    workflowRunId: run.id,
    fromNode: null,
    toNode: entryNode,
    kind: "trigger",
    payloadJson: { goal: d.goal },
  });

  return Response.json({ run });
}
