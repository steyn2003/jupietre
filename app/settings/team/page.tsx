import { redirect } from "next/navigation";
import { isNull, eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invites } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { listMembers, listTeamsForUser } from "@/lib/db/teams";
import { buildInviteUrl } from "@/lib/auth/invites";
import { AppShell } from "@/components/layout/AppShell";
import { TeamPanel } from "./team-panel";

export default async function TeamSettingsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const teams = await listTeamsForUser(session.userId);
  const team = teams[0] ?? null;
  const members = team ? await listMembers(team.id) : [];
  const myMembership = members.find((m) => m.userId === session.userId);
  const isOwner = myMembership?.role === "owner";

  const pendingInvites = team
    ? await db
        .select()
        .from(invites)
        .where(and(eq(invites.teamId, team.id), isNull(invites.consumedAt)))
    : [];

  return (
    <AppShell
      email={session.email}
      eyebrow="Settings"
      title="Team"
      description="Share sessions and team-scoped agents with other humans."
    >
      <TeamPanel
        team={team}
        isOwner={isOwner}
        currentUserId={session.userId}
        members={members.map((m) => ({
          userId: m.userId,
          email: m.email,
          displayName: m.displayName,
          role: m.role,
          addedAt: m.addedAt.toISOString(),
        }))}
        invites={pendingInvites.map((i) => ({
          id: i.id,
          email: i.email,
          teamRole: i.teamRole,
          url: buildInviteUrl(i.token),
          expiresAt: i.expiresAt.toISOString(),
        }))}
      />
    </AppShell>
  );
}
