import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { repos, sessions } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { getAgentConfigById } from "@/lib/db/agent-configs";
import {
  canUseAgent,
  canUseRepo,
  getMyTeamIds,
} from "@/lib/auth/authz";
import { startTurn } from "@/lib/agent/runner";
import { provisionWorktree } from "@/lib/worktrees/manager";

const bodySchema = z
  .object({
    agentConfigId: z.string().min(1),
    title: z.string().min(1).max(200),
    /** New shape (M11): pick a managed repo by id. */
    repoId: z.string().min(1).optional(),
    /** Legacy shape: caller supplied a raw path + label. Either repoId OR
     *  (repoLabel + repoPath) must be present. */
    repoLabel: z.string().nullable().optional(),
    repoPath: z.string().min(1).optional(),
    baseBranch: z.string().min(1).max(200).nullable().optional(),
    firstMessage: z.string().min(1),
    visibility: z.enum(["private", "team"]).default("private"),
    teamId: z.string().nullable().optional(),
  })
  .refine((d) => Boolean(d.repoId) || Boolean(d.repoPath), {
    message: "Either repoId or repoPath must be provided",
    path: ["repoId"],
  });

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const agent = await getAgentConfigById(d.agentConfigId);
  if (!agent)
    return Response.json({ error: "Agent not found" }, { status: 400 });

  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseAgent(
      session.userId,
      { userId: agent.userId, teamId: agent.teamId },
      new Set(myTeamIds),
    )
  ) {
    return Response.json({ error: "Agent not found" }, { status: 400 });
  }

  // Validate team visibility — user must be a member of the chosen team.
  let effectiveTeamId: string | null = null;
  if (d.visibility === "team") {
    if (!d.teamId || !myTeamIds.includes(d.teamId)) {
      return Response.json(
        { error: "Not a member of that team" },
        { status: 400 },
      );
    }
    effectiveTeamId = d.teamId;
  }

  // Resolve the repo: either a managed repo by id (M11), or a raw path
  // (legacy callers / Linear poller pre-migration).
  let resolvedRepoPath: string;
  let resolvedRepoLabel: string | null = d.repoLabel ?? null;
  let resolvedRepoId: string | null = null;
  let resolvedDefaultBranch: string | null = null;

  if (d.repoId) {
    const repoRow = (
      await db.select().from(repos).where(eq(repos.id, d.repoId)).limit(1)
    )[0];
    if (
      !repoRow ||
      !canUseRepo(
        session.userId,
        { userId: repoRow.userId, teamId: repoRow.teamId },
        new Set(myTeamIds),
      )
    ) {
      return Response.json(
        { error: "Repo not found" },
        { status: 400 },
      );
    }
    resolvedRepoPath = repoRow.clonePath;
    resolvedRepoLabel = resolvedRepoLabel ?? repoRow.slug;
    resolvedRepoId = repoRow.id;
    resolvedDefaultBranch = repoRow.defaultBranch;
  } else {
    resolvedRepoPath = d.repoPath as string;
  }

  const effectiveBaseBranch =
    (d.baseBranch && d.baseBranch.trim()) || resolvedDefaultBranch || null;

  const id = nanoid();
  await db.insert(sessions).values({
    id,
    userId: session.userId,
    ownerId: session.userId,
    agentConfigId: agent.id,
    title: d.title,
    repoLabel: resolvedRepoLabel,
    repoPath: resolvedRepoPath,
    repoId: resolvedRepoId,
    visibility: d.visibility,
    teamId: effectiveTeamId,
    status: "idle",
  });

  // Provision an isolated worktree so the agent never touches the source repo.
  // On failure: roll back the row and surface a clean 400.
  try {
    const wt = await provisionWorktree({
      sourceRepoPath: resolvedRepoPath,
      sessionId: id,
      baseBranch: effectiveBaseBranch,
    });
    await db
      .update(sessions)
      .set({
        worktreePath: wt.worktreePath,
        worktreeBranch: wt.worktreeBranch,
        baseSha: wt.baseSha,
        baseBranch: effectiveBaseBranch,
      })
      .where(eq(sessions.id, id));
  } catch (err) {
    await db.delete(sessions).where(eq(sessions.id, id));
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Could not provision worktree: ${message}` },
      { status: 400 },
    );
  }

  void startTurn({ sessionId: id, userText: d.firstMessage });

  return Response.json({ id });
}
