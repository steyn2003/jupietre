import { nanoid } from "nanoid";
import { getServerSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { getAgentConfigBySlug } from "@/lib/db/agent-configs";
import { resolveDataDir } from "@/lib/worktrees/manager";
import { startTurn } from "@/lib/agent/runner";

const FIRST_MESSAGE =
  `Hi — I'd like to add a new agent to this Jupietre instance. ` +
  `Walk me through the setup so we land on a config you're happy to ship.`;

/**
 * Spin up a no-repo session against the built-in agent-builder agent. The
 * builder doesn't touch a repo or worktree; cwd is the data root just so
 * file ops resolve to a known location. Sessions started here get the
 * agent-builder MCP tools wired in via lib/agent/mcp-tools/index.ts.
 */
export async function POST(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const builder = await getAgentConfigBySlug(session.userId, "agent-builder");
  if (!builder) {
    return Response.json(
      {
        error:
          "agent-builder not seeded yet. Restart the server so BUILT_INS run, then retry.",
      },
      { status: 500 },
    );
  }

  const sessionId = nanoid();
  await db.insert(sessions).values({
    id: sessionId,
    userId: session.userId,
    ownerId: session.userId,
    agentConfigId: builder.id,
    title: "Agent builder",
    repoLabel: "(builder)",
    repoPath: resolveDataDir(),
    repoId: null,
    source: "ui",
    status: "idle",
  });

  // Kick off the first turn with the canned greeting so the chat lands
  // ready-to-go rather than waiting on the user to type "hi".
  void startTurn({ sessionId, userText: FIRST_MESSAGE });

  return Response.json({ sessionId });
}
