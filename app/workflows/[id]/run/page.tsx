import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import {
  canUseWorkflow,
  getMyTeamIds,
  visibleReposWhere,
} from "@/lib/auth/authz";
import { getWorkflowDefinition } from "@/lib/workflows/runs";
import { AppShell } from "@/components/layout/AppShell";
import { StartRunForm } from "./start-run-form";

export default async function StartRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const loaded = await getWorkflowDefinition(id).catch(() => null);
  if (!loaded) notFound();
  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseWorkflow(
      session.userId,
      { ownerId: loaded.workflow.ownerId, teamId: loaded.workflow.teamId },
      new Set(myTeamIds),
    )
  ) {
    notFound();
  }

  const userRepos = await db
    .select({ id: repos.id, slug: repos.slug, githubRepo: repos.githubRepo })
    .from(repos)
    .where(visibleReposWhere(session.userId, myTeamIds));

  // Determine the entry node for display — always what canReceive: ["trigger"]
  // includes first (the same logic the dispatcher uses).
  const entryNode = Object.entries(loaded.definition.nodes).find(([, n]) =>
    n.canReceive.includes("trigger"),
  )?.[0];

  return (
    <AppShell
      email={session.email}
      eyebrow="Workflows"
      title={`Start run — ${loaded.workflow.name}`}
      description={
        entryNode
          ? `Kicks off the flow at node "${entryNode}". The dispatcher picks up within a couple of seconds.`
          : "This workflow has no entry node — edit it first."
      }
    >
      <StartRunForm
        workflowId={id}
        repos={userRepos}
        entryNode={entryNode ?? null}
      />
    </AppShell>
  );
}
