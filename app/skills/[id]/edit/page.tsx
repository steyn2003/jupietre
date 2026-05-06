import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
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

  return (
    <AppShell
      email={session.email}
      eyebrow="Configuration"
      title={`Edit ${row.name}`}
      back={{ href: "/skills", label: "Skills" }}
    >
      <SkillForm
        mode="edit"
        initial={{
          id: row.id,
          slug: row.slug,
          name: row.name,
          description: row.description,
          body: row.body,
        }}
      />
    </AppShell>
  );
}
