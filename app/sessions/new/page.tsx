import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { listVisibleAgentConfigs } from "@/lib/db/agent-configs";
import { getMyTeamIds, visibleReposWhere } from "@/lib/auth/authz";
import { listTeamsForUser } from "@/lib/db/teams";
import { AppShell } from "@/components/layout/AppShell";
import { NewSessionForm } from "./new-session-form";

export default async function NewSessionPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const [agents, teams, repoRows] = await Promise.all([
    listVisibleAgentConfigs(session.userId, myTeamIds),
    listTeamsForUser(session.userId),
    db.select().from(repos).where(visibleReposWhere(session.userId, myTeamIds)),
  ]);

  return (
    <AppShell
      email={session.email}
      eyebrow="Workspace"
      title="New session"
      description="Pick an agent, choose a repo, and tell it what to do."
      back={{ href: "/", label: "Sessions" }}
    >
      <NewSessionForm
        repos={repoRows.map((r) => ({
          id: r.id,
          slug: r.slug,
          githubRepo: r.githubRepo,
          defaultBranch: r.defaultBranch,
        }))}
        agents={agents.map((a) => ({
          id: a.id,
          slug: a.slug,
          name: a.name,
          teamId: a.teamId,
        }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
      />
    </AppShell>
  );
}
