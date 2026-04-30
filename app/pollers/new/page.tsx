import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { listVisibleAgentConfigs } from "@/lib/db/agent-configs";
import { getMyTeamIds } from "@/lib/auth/authz";
import { AppShell } from "@/components/layout/AppShell";
import { PollerForm } from "../poller-form";

export default async function NewPollerPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const agents = await listVisibleAgentConfigs(session.userId, myTeamIds);

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="New Linear poller"
      description="Pick an API key + cadence. Status → agent rules can be added after the poller is created."
      back={{ href: "/pollers", label: "Pollers" }}
    >
      <PollerForm
        mode="create"
        initial={{
          name: "",
          apiKey: "",
          teamKey: "",
          defaultLabel: "agent",
          pollIntervalMs: 120_000,
          enabled: true,
        }}
        agents={agents.map((a) => ({ id: a.id, name: a.name, slug: a.slug }))}
        rules={[]}
      />
    </AppShell>
  );
}
