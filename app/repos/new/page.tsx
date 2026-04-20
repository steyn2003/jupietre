import { redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teamMembers, teams } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/AppShell";
import { NewRepoForm } from "./new-repo-form";

export default async function NewRepoPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeams = await db
    .select({ id: teams.id, name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, session.userId));

  return (
    <AppShell
      email={session.email}
      back={{ href: "/repos", label: "Repos" }}
      eyebrow="Configuration"
      title="Add repo"
      description="Clones the repo via HTTPS using GITHUB_TOKEN. Lives at ./data/repos/<slug>."
    >
      <NewRepoForm teams={myTeams} />
      <p className="mt-4 text-[12px] text-fg-muted">
        Don&apos;t have <code className="font-mono">GITHUB_TOKEN</code> set?
        Public repos clone fine without it. Private repos need a token with
        the <code className="font-mono">repo</code> scope.{" "}
        <Link
          href="https://github.com/settings/personal-access-tokens"
          className="underline hover:text-fg"
        >
          Create one
        </Link>
        .
      </p>
    </AppShell>
  );
}
