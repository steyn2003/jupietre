import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleReposWhere } from "@/lib/auth/authz";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { AppShell } from "@/components/layout/AppShell";
import { SkillForm } from "../skill-form";

export default async function NewSkillPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const repoRows = await db
    .select({ id: repos.id, slug: repos.slug })
    .from(repos)
    .where(visibleReposWhere(session.userId, myTeamIds));

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title="New skill"
      description="A markdown file the agent loads when its description matches the work at hand."
      back={{ href: "/skills", label: "Skills" }}
    >
      <SkillForm
        mode="create"
        repos={repoRows}
        initial={{
          slug: "",
          name: "",
          description: "",
          body: "",
          repoId: null,
        }}
      />
    </AppShell>
  );
}
