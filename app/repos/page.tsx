import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleReposWhere } from "@/lib/auth/authz";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReposList } from "./repos-list";

export default async function ReposPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await db
    .select()
    .from(repos)
    .where(visibleReposWhere(session.userId, myTeamIds));

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="Repos"
      description="GitHub repos cloned and managed by Jupietre. Each session gets its own worktree off the cloned repo — your remote is the source of truth."
      action={
        <Link href="/repos/new">
          <Button
            trailingIcon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
          >
            Add repo
          </Button>
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          title="No repos yet"
          description="Add a GitHub repo to clone it into ./data/repos and make it available for new sessions."
          action={
            <Link href="/repos/new">
              <Button>Add a repo</Button>
            </Link>
          }
        />
      ) : (
        <ReposList
          currentUserId={session.userId}
          initial={rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            githubRepo: r.githubRepo,
            defaultBranch: r.defaultBranch,
            clonePath: r.clonePath,
            ownerId: r.userId,
            teamId: r.teamId,
          }))}
        />
      )}
    </AppShell>
  );
}
