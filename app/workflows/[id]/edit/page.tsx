import { redirect, notFound } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { canUseWorkflow, getMyTeamIds } from "@/lib/auth/authz";
import { listVisibleAgentConfigs } from "@/lib/db/agent-configs";
import { getWorkflowDefinition } from "@/lib/workflows/runs";
import { AppShell } from "@/components/layout/AppShell";
import { WorkflowForm } from "../../workflow-form";
import { initialFromDefinition } from "../../form-helpers";

export default async function EditWorkflowPage({
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

  const agents = await listVisibleAgentConfigs(session.userId, myTeamIds);

  return (
    <AppShell
      email={session.email}
      eyebrow="Workflows"
      title={loaded.workflow.name}
      description="Changes apply to new runs. In-flight runs keep using the definition they started with."
    >
      <WorkflowForm
        initial={initialFromDefinition(
          {
            id: loaded.workflow.id,
            name: loaded.workflow.name,
            slug: loaded.workflow.slug,
          },
          loaded.definition,
        )}
        agents={agents.map((a) => ({
          id: a.id,
          name: a.name,
          slug: a.slug,
        }))}
      />
    </AppShell>
  );
}
