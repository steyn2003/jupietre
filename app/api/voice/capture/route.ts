import type { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { getAgentConfigBySlug } from "@/lib/db/agent-configs";
import { resolveDataDir } from "@/lib/worktrees/manager";
import { startTurn } from "@/lib/agent/runner";

const schema = z.object({
  transcript: z.string().min(3).max(8_000),
});

/**
 * Take a captured voice transcript, kick off a one-shot session against the
 * voice-ticket agent, and return the new session id so the widget can link
 * the user to the run page.
 *
 * Sessions started here have no repo and no worktree — the agent's only job
 * is to call linear_create_issue once. cwd is the data dir so any local
 * file ops still resolve.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const agent = await getAgentConfigBySlug(session.userId, "voice-ticket");
  if (!agent) {
    return Response.json(
      {
        error:
          "voice-ticket agent not seeded yet. Restart the server so BUILT_INS run, then retry.",
      },
      { status: 500 },
    );
  }

  const transcript = parsed.data.transcript.trim();
  const sessionId = nanoid();
  const previewTitle =
    transcript.length > 60 ? transcript.slice(0, 57) + "..." : transcript;

  await db.insert(sessions).values({
    id: sessionId,
    userId: session.userId,
    ownerId: session.userId,
    agentConfigId: agent.id,
    title: `Voice: ${previewTitle}`,
    repoLabel: "(voice)",
    repoPath: resolveDataDir(),
    repoId: null,
    source: "ui",
    status: "idle",
  });

  const firstMessage =
    `The operator dictated the following while testing the application. ` +
    `Turn it into one Linear ticket via linear_create_issue, then stop.\n\n` +
    `## Transcript\n\n${transcript}\n`;
  void startTurn({ sessionId, userText: firstMessage });

  return Response.json({ sessionId });
}
