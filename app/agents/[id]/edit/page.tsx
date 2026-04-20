import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getAgentConfigById } from "@/lib/db/agent-configs";
import { canEditAgent } from "@/lib/auth/authz";
import { AppShell } from "@/components/layout/AppShell";
import { AgentForm } from "../../agent-form";

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const row = await getAgentConfigById(id);
  if (!row) notFound();
  const canEdit = await canEditAgent(session.userId, {
    userId: row.userId,
    teamId: row.teamId,
  });
  if (!canEdit) notFound();

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title={`Edit ${row.name}`}
      back={{ href: "/agents", label: "Agents" }}
    >
      <AgentForm
        mode="edit"
        initial={{
          id: row.id,
          slug: row.slug,
          name: row.name,
          systemPrompt: row.systemPrompt,
          model: row.model,
          fallbackModel: row.fallbackModel,
          allowedTools: row.allowedTools,
          disallowedTools: row.disallowedTools,
          includeProjectSkills: row.includeProjectSkills === 1,
          maxTurns: row.maxTurns,
          effort: row.effort,
          maxBudgetUsd: row.maxBudgetUsd,
          dailyBudgetUsd: row.dailyBudgetUsd,
          monthlyBudgetUsd: row.monthlyBudgetUsd,
          linearPickup: row.linearPickup === 1,
          enableLinearTools: row.enableLinearTools === 1,
          enableGithubTools: row.enableGithubTools === 1,
          approvalMode: row.approvalMode,
          approvalTools: row.approvalTools,
          approvalTimeoutSeconds: row.approvalTimeoutSeconds,
        }}
      />
    </AppShell>
  );
}
