import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import { listVisibleAgentConfigs } from "@/lib/db/agent-configs";
import {
  canEditPoller,
  getPollerById,
  listRulesForPoller,
} from "@/lib/db/linear-pollers";
import { AppShell } from "@/components/layout/AppShell";
import { PollerForm } from "../../poller-form";

export default async function EditPollerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const poller = await getPollerById(id);
  if (!poller) notFound();
  if (!canEditPoller(session.userId, poller)) notFound();

  const myTeamIds = await getMyTeamIds(session.userId);
  const [agents, rules] = await Promise.all([
    listVisibleAgentConfigs(session.userId, myTeamIds),
    listRulesForPoller(id),
  ]);

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title={`Edit ${poller.name}`}
      back={{ href: "/pollers", label: "Pollers" }}
    >
      <PollerForm
        mode="edit"
        initial={{
          id: poller.id,
          name: poller.name,
          apiKey: poller.apiKey,
          teamKey: poller.teamKey ?? "",
          defaultLabel: poller.defaultLabel,
          pollIntervalMs: poller.pollIntervalMs,
          enabled: poller.enabled === 1,
        }}
        agents={agents.map((a) => ({ id: a.id, name: a.name, slug: a.slug }))}
        rules={rules.map((r) => ({
          id: r.id,
          mode: r.mode,
          pickupState: r.pickupState,
          inProgressState: r.inProgressState,
          agentConfigId: r.agentConfigId,
          labelOverride: r.labelOverride,
          workflowTemplate: r.workflowTemplate,
        }))}
      />
    </AppShell>
  );
}
