import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import { listVisibleSkills } from "@/lib/db/skills";
import { AppShell } from "@/components/layout/AppShell";
import { AgentForm } from "../agent-form";

export default async function NewAgentPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const availableSkills = await listVisibleSkills(session.userId, myTeamIds);

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="New agent"
      description="Configure a reusable role: system prompt, model, tools, budget, and approval policy."
      back={{ href: "/agents", label: "Agents" }}
    >
      <AgentForm
        mode="create"
        availableSkills={availableSkills.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
        }))}
        initial={{
          slug: "",
          name: "",
          systemPrompt: "",
          model: "claude-opus-4-6",
          fallbackModel: "claude-sonnet-4-6",
          allowedTools: null,
          disallowedTools: [],
          includeProjectSkills: true,
          selectedSkills: null,
          maxTurns: 100,
          effort: "high",
          maxBudgetUsd: null,
          dailyBudgetUsd: null,
          monthlyBudgetUsd: null,
          enableLinearTools: false,
          enableGithubTools: false,
          approvalMode: "none",
          approvalTools: [],
          approvalTimeoutSeconds: 300,
        }}
      />
    </AppShell>
  );
}
