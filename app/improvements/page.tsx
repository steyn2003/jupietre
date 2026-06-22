import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { LightbulbIcon } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db/client";
import { agentConfigs, sessions, toolApprovalRequests } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleSessionsWhere } from "@/lib/auth/authz";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { RunScoutButton } from "./run-scout-button";

// The nightly Scout runs (lib/scout/nightly.ts) all use the built-in agent
// with slug 'scout'. This page is just the Sessions list filtered to those
// runs, plus a count of pending ticket proposals (approval-gated
// linear_create_issue calls) waiting on the operator.

const statusTone: Record<
  string,
  "accent" | "success" | "warning" | "danger" | "neutral"
> = {
  running: "accent",
  complete: "success",
  error: "danger",
  idle: "neutral",
};

export default async function ImprovementsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);

  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      repoLabel: sessions.repoLabel,
      repoPath: sessions.repoPath,
      status: sessions.status,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .innerJoin(agentConfigs, eq(agentConfigs.id, sessions.agentConfigId))
    .where(
      and(
        eq(agentConfigs.slug, "scout"),
        visibleSessionsWhere(session.userId, myTeamIds),
      ),
    )
    .orderBy(desc(sessions.updatedAt))
    .limit(100);

  // Pending proposals per session = approval-gated tickets awaiting decision.
  const pendingBySession = new Map<string, number>();
  if (rows.length > 0) {
    const pending = await db
      .select({
        sessionId: toolApprovalRequests.sessionId,
        status: toolApprovalRequests.status,
      })
      .from(toolApprovalRequests)
      .where(eq(toolApprovalRequests.status, "pending"));
    for (const p of pending) {
      pendingBySession.set(
        p.sessionId,
        (pendingBySession.get(p.sessionId) ?? 0) + 1,
      );
    }
  }

  return (
    <AppShell
      email={session.email}
      eyebrow="Workspace"
      title="Improvements"
      description="Every night Scout studies your repos and proposes small, high-leverage tickets. Open a run to approve or deny each proposal."
      action={<RunScoutButton />}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<LightbulbIcon weight="regular" className="h-5 w-5" />}
          title="No scout runs yet"
          description="Scout runs nightly over your registered repos. Once it has run, its proposed improvements show up here for you to approve."
        />
      ) : (
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {rows.map((s) => {
            const pending = pendingBySession.get(s.id) ?? 0;
            return (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className="group flex items-center gap-4 px-5 py-4 hover:bg-surface-2/60 transition-colors duration-150"
                >
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-[14px] font-medium text-fg">
                      {s.title}
                    </span>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-fg-muted">
                      <span className="truncate font-mono text-fg-subtle">
                        {s.repoLabel ?? s.repoPath}
                      </span>
                      <span className="text-fg-subtle">·</span>
                      <span>{s.updatedAt.toLocaleString()}</span>
                    </div>
                  </div>
                  {pending > 0 ? (
                    <Badge tone="warning" dot>
                      {pending} to approve
                    </Badge>
                  ) : null}
                  <Badge tone={statusTone[s.status] ?? "neutral"} dot>
                    {s.status}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
