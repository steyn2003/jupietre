import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/AppShell";
import { SkillForm } from "../skill-form";

export default async function NewSkillPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

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
        initial={{
          slug: "",
          name: "",
          description: "",
          body: "",
        }}
      />
    </AppShell>
  );
}
