import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import { listVisibleAgentConfigs } from "@/lib/db/agent-configs";
import { AppShell } from "@/components/layout/AppShell";
import { WorkflowForm, emptyWorkflowInitial } from "../workflow-form";

export default async function NewWorkflowPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const agents = await listVisibleAgentConfigs(session.userId, myTeamIds);

  return (
    <AppShell
      email={session.email}
      eyebrow="Workflows"
      title="New workflow"
      description="Start from scratch. Add nodes for each role, then declare the transitions between them. The built-in pm-eng-qa is a good reference — clone and edit it if you want something similar."
    >
      <WorkflowForm
        initial={emptyWorkflowInitial()}
        agents={agents.map((a) => ({
          id: a.id,
          name: a.name,
          slug: a.slug,
        }))}
      />
    </AppShell>
  );
}
