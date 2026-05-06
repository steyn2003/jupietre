import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import { listVisibleSkills } from "@/lib/db/skills";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { SkillsList } from "./skills-list";

export default async function SkillsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const skills = await listVisibleSkills(session.userId, myTeamIds);

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="Skills"
      description="UI-managed Claude Agent SDK skills. Each skill is a SKILL.md materialized into the per-session worktree's .claude/skills/ directory. Sub-files in the repo's skills/ folder still flow in alongside; DB skills overlay on slug collision."
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
      <SkillsList
        currentUserId={session.userId}
        initial={skills.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          description: s.description,
          ownerId: s.ownerId,
          teamId: s.teamId,
        }))}
      />
    </AppShell>
  );
}
