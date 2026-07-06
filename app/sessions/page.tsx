import { redirect } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { PlusIcon, GitBranchIcon } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db/client";
import { agentConfigs, sessions } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleSessionsWhere } from "@/lib/auth/authz";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const statusTone: Record<string, "accent" | "success" | "warning" | "danger" | "neutral"> = {
  running: "accent",
  complete: "success",
  error: "danger",
  idle: "neutral",
};

export default async function SessionsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);

  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      source: sessions.source,
      repoLabel: sessions.repoLabel,
      repoPath: sessions.repoPath,
      status: sessions.status,
      visibility: sessions.visibility,
      ownerId: sessions.ownerId,
      updatedAt: sessions.updatedAt,
      agentName: agentConfigs.name,
    })
    .from(sessions)
    .leftJoin(agentConfigs, eq(agentConfigs.id, sessions.agentConfigId))
    .where(visibleSessionsWhere(session.userId, myTeamIds))
    .orderBy(desc(sessions.updatedAt))
    .limit(100);

  return (
    <AppShell
      email={session.email}
      eyebrow="Workspace"
      title="Sessions"
      description="Conversations with your agents — running, paused, and shared. Pick one up where you left off, or start something new."
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
      {rows.length === 0 ? (
        <EmptyState
          icon={<GitBranchIcon weight="regular" className="h-5 w-5" />}
          title="No sessions yet"
          description="Sessions are conversations with your agents — start one to give an agent its first task."
          action={
            <Link href="/sessions/new">
              <Button>Start a session</Button>
            </Link>
          }
        />
      ) : (
        <SessionGroups rows={rows} currentUserId={session.userId} />
      )}
    </AppShell>
  );
}

type Row = {
  id: string;
  title: string;
  source: string;
  repoLabel: string | null;
  repoPath: string;
  status: string;
  visibility: string;
  ownerId: string | null;
  updatedAt: Date;
  agentName: string | null;
};

function SessionGroups({
  rows,
  currentUserId,
}: {
  rows: Row[];
  currentUserId: string;
}) {
  const groups = groupByDate(rows);
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.label} className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle font-medium px-1">
            {g.label}
          </h2>
          <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
            {g.rows.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className="group flex items-center gap-4 px-5 py-4 hover:bg-surface-2/60 transition-colors duration-150"
                >
                  <StatusDot status={s.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="truncate text-[14px] font-medium text-fg">
                        {s.title}
                      </span>
                      {s.source === "linear" ? (
                        <Badge tone="accent">Linear</Badge>
                      ) : null}
                      {s.visibility === "team" ? <Badge>Team</Badge> : null}
                      {s.ownerId && s.ownerId !== currentUserId ? (
                        <Badge>shared</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-fg-muted">
                      <span>{s.agentName ?? "Agent"}</span>
                      <span className="text-fg-subtle">·</span>
                      <span className="truncate font-mono text-fg-subtle">
                        {s.repoLabel ?? s.repoPath}
                      </span>
                    </div>
                  </div>
                  <Badge tone={statusTone[s.status] ?? "neutral"} dot>
                    {s.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "var(--accent)"
      : status === "error"
        ? "var(--danger)"
        : status === "complete"
          ? "var(--success)"
          : "var(--fg-subtle)";
  return (
    <span
      aria-hidden
      className="relative h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    >
      {status === "running" ? (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ background: color, opacity: 0.45 }}
        />
      ) : null}
    </span>
  );
}

/* Buckets sessions by Today / Yesterday / This week / Earlier — keeps the
   list scannable once you have more than a dozen sessions. */
function groupByDate(rows: Row[]): Array<{ label: string; rows: Row[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86_400_000);

  const today: Row[] = [];
  const yesterday: Row[] = [];
  const thisWeek: Row[] = [];
  const earlier: Row[] = [];

  for (const r of rows) {
    const t = r.updatedAt.getTime();
    if (t >= startOfToday.getTime()) today.push(r);
    else if (t >= startOfYesterday.getTime()) yesterday.push(r);
    else if (t >= startOfWeek.getTime()) thisWeek.push(r);
    else earlier.push(r);
  }

  return [
    { label: "Today", rows: today },
    { label: "Yesterday", rows: yesterday },
    { label: "This week", rows: thisWeek },
    { label: "Earlier", rows: earlier },
  ].filter((g) => g.rows.length > 0);
}
