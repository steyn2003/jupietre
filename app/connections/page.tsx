import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teamMembers, teams } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import { listVisibleAgentConfigs } from "@/lib/db/agent-configs";
import {
  grantsForConnections,
  listVisibleConnections,
  redactConnection,
} from "@/lib/db/connections";
import { AppShell } from "@/components/layout/AppShell";
import { ConnectionsManager } from "./connections-manager";

export default async function ConnectionsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);

  // Teams where I'm an owner → drives canEdit for team-scoped connections.
  const memberships = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, session.userId));
  const ownerTeamIds = new Set(
    memberships.filter((m) => m.role === "owner").map((m) => m.teamId),
  );

  const [rawConnections, agents, myTeams] = await Promise.all([
    listVisibleConnections(session.userId, myTeamIds),
    listVisibleAgentConfigs(session.userId, myTeamIds),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, session.userId)),
  ]);

  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));
  const grants = await grantsForConnections(rawConnections.map((c) => c.id));
  const agentsByConnection = new Map<string, { id: string; name: string }[]>();
  for (const g of grants) {
    const name = agentNameById.get(g.agentConfigId);
    if (!name) continue; // grant points at an agent the caller can't see
    const list = agentsByConnection.get(g.connectionId) ?? [];
    list.push({ id: g.agentConfigId, name });
    agentsByConnection.set(g.connectionId, list);
  }

  const rows = rawConnections.map((c) => {
    const r = redactConnection(c);
    const canEdit =
      (r.ownerId === session.userId && r.teamId === null) ||
      (r.teamId !== null && ownerTeamIds.has(r.teamId));
    return {
      ...r,
      canEdit,
      grantedAgents: agentsByConnection.get(c.id) ?? [],
    };
  });

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="Connections"
      description="Credentialed resources you register once and grant to agents — Linear workspaces, GitHub tokens, and external MCP servers. Grant them on the Control canvas or from an agent's inspector. Secrets are write-only."
    >
      <ConnectionsManager
        initial={rows}
        teams={myTeams}
        currentUserId={session.userId}
      />
    </AppShell>
  );
}
