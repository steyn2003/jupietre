import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { LightbulbIcon } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db/client";
import { agentConfigs, sessionMessages, sessions } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleSessionsWhere } from "@/lib/auth/authz";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Markdown } from "@/components/chat/Markdown";
import { RunScoutButton } from "./run-scout-button";
import { CreateTicketButton } from "./create-ticket-button";

// Scout runs (lib/scout/nightly.ts) all use the built-in agent with slug
// 'scout'. This page lists those runs and renders each one's final report —
// Scout's only deliverable. No tickets are filed automatically.

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
    .limit(50);

  // Latest assistant message per run = Scout's report. One query for all
  // visible runs; keep the highest-index assistant text per session.
  const reportBySession = new Map<string, string>();
  if (rows.length > 0) {
    const msgs = await db
      .select({
        sessionId: sessionMessages.sessionId,
        index: sessionMessages.indexInSession,
        text: sessionMessages.text,
      })
      .from(sessionMessages)
      .where(
        and(
          inArray(
            sessionMessages.sessionId,
            rows.map((r) => r.id),
          ),
          eq(sessionMessages.kind, "assistant"),
        ),
      )
      .orderBy(sessionMessages.indexInSession);
    for (const m of msgs) reportBySession.set(m.sessionId, m.text); // last wins = highest index
  }

  return (
    <AppShell
      email={session.email}
      eyebrow="Workspace"
      title="Improvements"
      description="Scout studies your repos and reports small, high-leverage improvements here. Give it a focus to aim the run, or read the latest reports below."
      action={<RunScoutButton />}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<LightbulbIcon weight="regular" className="h-5 w-5" />}
          title="No scout runs yet"
          description="Run Scout with the button above (optionally with a focus like “check for N+1”). Its report shows up here — no tickets are filed automatically."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((s) => {
            const report = reportBySession.get(s.id);
            return (
              <section
                key={s.id}
                className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 overflow-hidden"
              >
                <header className="flex items-center gap-3 px-5 py-3 border-b border-hairline">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/sessions/${s.id}`}
                      className="truncate text-[14px] font-medium text-fg hover:text-accent"
                    >
                      {s.title}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-[12px] text-fg-muted">
                      <span className="truncate font-mono text-fg-subtle">
                        {s.repoLabel ?? s.repoPath}
                      </span>
                      <span className="text-fg-subtle">·</span>
                      <span>{s.updatedAt.toLocaleString()}</span>
                    </div>
                  </div>
                  <Badge tone={statusTone[s.status] ?? "neutral"} dot>
                    {s.status}
                  </Badge>
                </header>
                <div className="px-5 py-4">
                  {report ? (
                    <>
                      <Markdown>{report}</Markdown>
                      <div className="mt-4 flex items-center justify-end gap-3 border-t border-hairline pt-3">
                        <span className="text-[12px] text-fg-subtle">
                          Files a Linear ticket labelled{" "}
                          <span className="font-mono">{s.repoLabel}</span>
                        </span>
                        <CreateTicketButton sessionId={s.id} />
                      </div>
                    </>
                  ) : (
                    <p className="text-[13px] text-fg-muted">
                      {s.status === "running"
                        ? "Scout is still working — the report will appear here when it finishes."
                        : "No report yet."}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
