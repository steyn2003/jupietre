import type { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentConfigs, sessions } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { loadReadableSession } from "@/lib/auth/authz";

export interface TreeNode {
  id: string;
  parentId: string | null;
  title: string;
  agentName: string;
  status: string;
  costUsd: number;
  createdAt: string;
}

type SessionRow = typeof sessions.$inferSelect;

/**
 * The delegation tree this session belongs to: walk up through agent_spawn
 * links (source="agent") to the orchestrator root, then BFS all spawned
 * descendants. Fork links (source!="agent") are not part of the tree.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const focused = await loadReadableSession(id, session.userId);
  if (!focused) return Response.json({ error: "Not found" }, { status: 404 });

  // Walk up to the root of the delegation chain.
  let root: SessionRow = focused;
  for (let i = 0; i < 10 && root.source === "agent" && root.parentSessionId; i++) {
    const parent = (
      await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, root.parentSessionId))
        .limit(1)
    )[0];
    if (!parent) break;
    root = parent;
  }

  // BFS down: collect every session spawned (transitively) by the root.
  const rows: SessionRow[] = [root];
  let frontier = [root.id];
  for (let i = 0; i < 10 && frontier.length > 0; i++) {
    const children = await db
      .select()
      .from(sessions)
      .where(inArray(sessions.parentSessionId, frontier));
    const spawned = children.filter((c) => c.source === "agent");
    rows.push(...spawned);
    frontier = spawned.map((c) => c.id);
  }

  const agentIds = [...new Set(rows.map((r) => r.agentConfigId))];
  const agents = agentIds.length
    ? await db
        .select({ id: agentConfigs.id, name: agentConfigs.name })
        .from(agentConfigs)
        .where(inArray(agentConfigs.id, agentIds))
    : [];
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

  const nodes: TreeNode[] = rows.map((r) => ({
    id: r.id,
    // The root keeps parentId null even if it was forked from somewhere.
    parentId: r.id === root.id ? null : r.parentSessionId,
    title: r.title,
    agentName: agentNameById.get(r.agentConfigId) ?? "(deleted agent)",
    status: r.status,
    costUsd: Number.parseFloat(r.totalCostUsd ?? "0") || 0,
    createdAt: r.createdAt.toISOString(),
  }));

  return Response.json({ rootId: root.id, focusedId: id, nodes });
}
