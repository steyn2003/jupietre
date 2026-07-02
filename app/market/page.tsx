import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { listAgentConfigs } from "@/lib/db/agent-configs";
import { AGENT_TEMPLATES, TEAM_TEMPLATES } from "@/lib/market/catalog";
import { AppShell } from "@/components/layout/AppShell";
import { MarketClient } from "./market-client";

export default async function MarketPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const mine = await listAgentConfigs(session.userId);
  const installed = new Set(mine.map((a) => a.slug));

  return (
    <AppShell
      email={session.email}
      eyebrow="Catalog"
      title="Agent market"
      description="Install ready-made agents and whole teams. A team ships its specialists plus a lead orchestrator — start a session with the lead and it delegates across the squad. Installed agents are yours to edit under Agents."
    >
      <MarketClient
        teams={TEAM_TEMPLATES.map((t) => ({
          slug: t.slug,
          name: t.name,
          tagline: t.tagline,
          leadSlug: t.lead.slug,
          leadName: t.lead.name,
          members: t.members.map((m) => {
            const tpl = AGENT_TEMPLATES.find((a) => a.slug === m);
            return { slug: m, name: tpl?.name ?? m };
          }),
          installed:
            installed.has(t.lead.slug) &&
            t.members.every((m) => installed.has(m)),
        }))}
        agents={AGENT_TEMPLATES.map((a) => ({
          slug: a.slug,
          name: a.name,
          tagline: a.tagline,
          category: a.category,
          model: a.model,
          installed: installed.has(a.slug),
        }))}
      />
    </AppShell>
  );
}
