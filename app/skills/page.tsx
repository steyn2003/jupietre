import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleReposWhere } from "@/lib/auth/authz";
import { listVisibleSkills } from "@/lib/db/skills";
import { listVisiblePendingDrafts } from "@/lib/db/skill-drafts";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { SkillsWorkspace } from "./skills-workspace";

export default async function SkillsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const [skills, drafts, repoRows] = await Promise.all([
    listVisibleSkills(session.userId, myTeamIds),
    listVisiblePendingDrafts(session.userId, myTeamIds),
    db
      .select({ id: repos.id, slug: repos.slug })
      .from(repos)
      .where(visibleReposWhere(session.userId, myTeamIds)),
  ]);
  const repoSlug = new Map(repoRows.map((r) => [r.id, r.slug]));

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="Skills"
      description="UI-managed Claude Agent SDK skills. Each skill is a SKILL.md materialized into the per-session worktree's .claude/skills/ directory. Repo-scoped skills only flow into sessions on their repo; drafts are distilled automatically from finished sessions for you to approve."
      action={
        <Link href="/skills/new">
          <Button
            trailingIcon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
          >
            New skill
          </Button>
        </Link>
      }
    >
      <SkillsWorkspace
        currentUserId={session.userId}
        initialSkills={skills.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          description: s.description,
          ownerId: s.ownerId,
          teamId: s.teamId,
          repoId: s.repoId,
          repoSlug: s.repoId ? (repoSlug.get(s.repoId) ?? null) : null,
        }))}
        initialDrafts={drafts.map((d) => ({
          id: d.id,
          slug: d.slug,
          name: d.name,
          description: d.description,
          body: d.body,
          teamId: d.teamId,
          repoId: d.repoId,
          repoSlug: d.repoId ? (repoSlug.get(d.repoId) ?? null) : null,
          sourceSessionId: d.sourceSessionId,
          createdAt: d.createdAt.toISOString(),
        }))}
      />
    </AppShell>
  );
}
