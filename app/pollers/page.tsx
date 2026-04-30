import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import {
  listVisiblePollers,
  listRulesForPoller,
} from "@/lib/db/linear-pollers";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { PollersList } from "./pollers-list";

export default async function PollersPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const pollers = await listVisiblePollers(session.userId, myTeamIds);
  const rows = await Promise.all(
    pollers.map(async (p) => ({
      id: p.id,
      name: p.name,
      teamKey: p.teamKey,
      defaultLabel: p.defaultLabel,
      pollIntervalMs: p.pollIntervalMs,
      enabled: p.enabled === 1,
      ownerId: p.ownerId,
      teamId: p.teamId,
      ruleCount: (await listRulesForPoller(p.id)).length,
    })),
  );

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="Linear pollers"
      description="One row per Linear workspace. Each poller maps issue states to agents — when a ticket lands in a pickup state, the configured agent picks it up and runs the rule's workflow."
      action={
        <Link href="/pollers/new">
          <Button
            trailingIcon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
          >
            New poller
          </Button>
        </Link>
      }
    >
      <PollersList currentUserId={session.userId} initial={rows} />
    </AppShell>
  );
}
