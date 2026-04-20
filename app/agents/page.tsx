import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { getServerSession } from "@/lib/auth/session";
import { listVisibleAgentConfigs } from "@/lib/db/agent-configs";
import { getMyTeamIds } from "@/lib/auth/authz";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { AgentsList } from "./agents-list";

export default async function AgentsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const agents = await listVisibleAgentConfigs(session.userId, myTeamIds);

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="Agents"
      description="Configure the roles available for new sessions and Linear pickup. Each agent owns its own model, tools, and budget."
      action={
        <Link href="/agents/new">
          <Button
            trailingIcon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
          >
            New agent
          </Button>
        </Link>
      }
    >
      <AgentsList
        currentUserId={session.userId}
        initial={agents.map((a) => ({
          id: a.id,
          slug: a.slug,
          name: a.name,
          model: a.model,
          maxTurns: a.maxTurns,
          maxBudgetUsd: a.maxBudgetUsd,
          linearPickup: a.linearPickup === 1,
          ownerId: a.userId,
          teamId: a.teamId,
        }))}
      />
    </AppShell>
  );
}
