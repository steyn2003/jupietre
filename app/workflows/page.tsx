import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import { listVisibleWorkflows } from "@/lib/workflows/runs";
import { parseWorkflowDefinition } from "@/lib/workflows/definitions";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorkflowsList } from "./workflows-list";

export default async function WorkflowsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await listVisibleWorkflows(session.userId, myTeamIds);

  const initial = rows.map((w) => {
    let nodeCount = 0;
    let transitionCount = 0;
    try {
      const def = parseWorkflowDefinition(w.definition);
      nodeCount = Object.keys(def.nodes).length;
      transitionCount = def.transitions.length;
    } catch {
      // Broken definition — show 0/0, the detail page will surface the error.
    }
    return {
      id: w.id,
      slug: w.slug,
      name: w.name,
      nodeCount,
      transitionCount,
      ownerId: w.ownerId,
      teamId: w.teamId,
    };
  });

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="Workflows"
      description="Multi-agent flows — a DAG of your configured agents passing short handoff messages to each other. Edit the triangle, clone it, or start from scratch."
      action={
        <Link href="/workflows/new">
          <Button
            trailingIcon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
          >
            New workflow
          </Button>
        </Link>
      }
    >
      {initial.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          description="A workflow is a reusable flow between agents. The built-in 'pm-eng-qa' triangle is seeded per user — log in again if you expected to see it."
          action={
            <Link href="/workflows/new">
              <Button>Create a workflow</Button>
            </Link>
          }
        />
      ) : (
        <WorkflowsList currentUserId={session.userId} initial={initial} />
      )}
    </AppShell>
  );
}
