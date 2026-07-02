import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getServerSession } from "@/lib/auth/session";
import { listSchedules } from "@/lib/db/schedules";
import { listAgentConfigs } from "@/lib/db/agent-configs";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { AppShell } from "@/components/layout/AppShell";
import { SchedulesClient } from "./schedules-client";

export default async function SchedulesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [schedules, agents, myRepos] = await Promise.all([
    listSchedules(session.userId),
    listAgentConfigs(session.userId),
    db.select().from(repos).where(eq(repos.userId, session.userId)),
  ]);

  return (
    <AppShell
      email={session.email}
      eyebrow="Automation"
      title="Schedules"
      description="Recurring agent runs — once per day after the chosen hour, the agent kicks off with your prompt against one repo or all of them. The nightly Scout lives here too."
    >
      <SchedulesClient
        initial={schedules.map((s) => ({
          id: s.id,
          name: s.name,
          agentConfigId: s.agentConfigId,
          repoId: s.repoId,
          prompt: s.prompt,
          hour: s.hour,
          enabled: s.enabled === 1,
          lastRunDay: s.lastRunDay,
        }))}
        agents={agents.map((a) => ({ id: a.id, slug: a.slug, name: a.name }))}
        repos={myRepos.map((r) => ({ id: r.id, slug: r.slug }))}
      />
    </AppShell>
  );
}
