import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleReposWhere } from "@/lib/auth/authz";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { canEditSkill, getSkillById } from "@/lib/db/skills";
import { AppShell } from "@/components/layout/AppShell";
import { SkillForm } from "../../skill-form";

export default async function EditSkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const row = await getSkillById(id);
  if (!row) notFound();
  if (!canEditSkill(session.userId, row)) notFound();

  const myTeamIds = await getMyTeamIds(session.userId);
  const repoRows = await db
    .select({ id: repos.id, slug: repos.slug })
    .from(repos)
    .where(visibleReposWhere(session.userId, myTeamIds));

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title={`Edit ${row.name}`}
      back={{ href: "/skills", label: "Skills" }}
    >
      <SkillForm
        mode="edit"
        repos={repoRows}
        initial={{
          id: row.id,
          slug: row.slug,
          name: row.name,
          description: row.description,
          body: row.body,
          repoId: row.repoId,
        }}
      />
    </AppShell>
  );
}
