import "server-only";
import { and, asc, eq, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { sessionMessages, sessions } from "@/lib/db/schema";
import { loadReadableSession } from "@/lib/auth/authz";
import { provisionWorktree } from "@/lib/worktrees/manager";

export interface ForkResult {
  id: string;
  parentId: string;
  forkedAtMessageIndex: number;
  copiedMessageCount: number;
}

export class ForkError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404,
  ) {
    super(message);
  }
}

/**
 * Create a new session that branches off `parentId` at `atMessageIndex`.
 * Copies all parent messages with `indexInSession <= atMessageIndex` into the
 * new session and resets the SDK session id so the next turn starts fresh
 * (the runner replays the copied transcript on that first turn).
 */
export async function forkSession(params: {
  parentId: string;
  atMessageIndex: number;
  userId: string;
}): Promise<ForkResult> {
  const { parentId, atMessageIndex, userId } = params;

  if (!Number.isInteger(atMessageIndex) || atMessageIndex < 0) {
    throw new ForkError("atMessageIndex must be a non-negative integer", 400);
  }

  const parent = await loadReadableSession(parentId, userId);
  if (!parent) throw new ForkError("Parent session not found", 404);

  const toCopy = await db
    .select()
    .from(sessionMessages)
    .where(
      and(
        eq(sessionMessages.sessionId, parentId),
        lte(sessionMessages.indexInSession, atMessageIndex),
      ),
    )
    .orderBy(asc(sessionMessages.indexInSession));

  if (toCopy.length === 0) {
    throw new ForkError("Nothing to fork — message index out of range", 400);
  }

  const newId = nanoid();
  const titleSuffix = "(fork)";
  const titleBase = parent.title.endsWith(titleSuffix)
    ? parent.title
    : `${parent.title} ${titleSuffix}`;

  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      id: newId,
      userId,
      ownerId: userId,
      teamId: null,
      visibility: "private",
      agentConfigId: parent.agentConfigId,
      title: titleBase,
      repoLabel: parent.repoLabel,
      repoPath: parent.repoPath,
      source: "ui",
      // Fresh SDK + diff baseline so the new session has its own.
      sdkSessionId: null,
      baseSha: null,
      status: "idle",
      totalCostUsd: "0",
      parentSessionId: parentId,
      forkedAtMessageIndex: atMessageIndex,
    });

    if (toCopy.length > 0) {
      await tx.insert(sessionMessages).values(
        toCopy.map((m) => ({
          id: nanoid(),
          sessionId: newId,
          indexInSession: m.indexInSession,
          kind: m.kind,
          text: m.text,
          raw: m.raw,
        })),
      );
    }
  });

  // Provision an isolated worktree for the fork off the original source repo
  // (not the parent's worktree) so the fork has its own working tree to mess
  // with. Inherits the parent's baseBranch so the fork stays on the same base.
  // Failure here should still let the fork exist — the runner will fall back
  // to repoPath if worktreePath is null.
  try {
    const wt = await provisionWorktree({
      sourceRepoPath: parent.repoPath,
      sessionId: newId,
      baseBranch: parent.baseBranch ?? null,
    });
    await db
      .update(sessions)
      .set({
        worktreePath: wt.worktreePath,
        worktreeBranch: wt.worktreeBranch,
        baseSha: wt.baseSha,
        baseBranch: parent.baseBranch ?? null,
      })
      .where(eq(sessions.id, newId));
  } catch (err) {
    console.warn(
      `[fork] worktree provisioning failed for ${newId}; running against source:`,
      err,
    );
  }

  return {
    id: newId,
    parentId,
    forkedAtMessageIndex: atMessageIndex,
    copiedMessageCount: toCopy.length,
  };
}
