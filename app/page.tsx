import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { getServerSession } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { OsCanvas } from "./os-canvas";

export default async function Home() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <AppShell
      email={session.email}
      eyebrow="Agentic OS"
      title="Control"
      description="Your live control plane — every trigger, agent, and resource wired together, with running sessions lighting up as work flows through."
      fluid
      action={
        <Link href="/sessions/new">
          <Button
            trailingIcon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
          >
            New session
          </Button>
        </Link>
      }
    >
      <OsCanvas />
    </AppShell>
  );
}
