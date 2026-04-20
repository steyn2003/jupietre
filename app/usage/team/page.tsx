import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usageEvents, users } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { listTeamsForUser } from "@/lib/db/teams";
import {
  getAgentBreakdown,
  getDailySpendSeries,
  getTeamSpendWindow,
  getTopSessions,
  microUsdToUsd,
} from "@/lib/db/usage";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatRow, type Stat } from "@/components/ui/StatRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sparkline } from "../sparkline";

function fmtUsd(micro: number): string {
  return `$${microUsdToUsd(micro).toFixed(2)}`;
}

async function getPerMemberBreakdown(
  teamId: string,
  days: number,
): Promise<Array<{ userId: string; label: string; costMicroUsd: number }>> {
  const since = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() - (days - 1),
    ),
  );
  const rows = await db
    .select({
      userId: usageEvents.userId,
      email: users.email,
      displayName: users.displayName,
      total: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
    })
    .from(usageEvents)
    .innerJoin(users, eq(users.id, usageEvents.userId))
    .where(and(eq(usageEvents.teamId, teamId), gte(usageEvents.at, since)))
    .groupBy(usageEvents.userId, users.email, users.displayName)
    .orderBy(desc(sql`sum(${usageEvents.costMicroUsd})`));

  return rows.map((r) => ({
    userId: r.userId,
    label: r.displayName ?? r.email,
    costMicroUsd: Number(r.total),
  }));
}

export default async function TeamUsagePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const teams = await listTeamsForUser(session.userId);
  if (teams.length === 0) {
    return (
      <AppShell
        email={session.email}
        eyebrow="Spend"
        title="Team usage"
        back={{ href: "/usage", label: "Usage" }}
      >
        <EmptyState
          title="Not in a team yet"
          description="Create or join a team from the Team settings to see shared spend here."
        />
      </AppShell>
    );
  }

  const team = teams[0]!;
  const [today, month, series, breakdown, topSessions, members] =
    await Promise.all([
      getTeamSpendWindow(team.id, "day"),
      getTeamSpendWindow(team.id, "month"),
      getDailySpendSeries({ teamId: team.id, days: 30 }),
      getAgentBreakdown({ teamId: team.id, days: 30 }),
      getTopSessions({ teamId: team.id, days: 30, limit: 5 }),
      getPerMemberBreakdown(team.id, 30),
    ]);

  const total30 = series.reduce((s, d) => s + d.costMicroUsd, 0);
  const peak = series.reduce((m, d) => Math.max(m, d.costMicroUsd), 0);

  const stats: Stat[] = [
    { label: "Today", value: fmtUsd(today) },
    { label: "This month", value: fmtUsd(month) },
    { label: "30-day total", value: fmtUsd(total30) },
    { label: "30-day peak", value: fmtUsd(peak) },
  ];

  return (
    <AppShell
      email={session.email}
      eyebrow={team.name}
      title="Team usage"
      description="Spend here counts only sessions with team visibility scoped to this team. Private sessions stay in personal usage."
      back={{ href: "/usage", label: "Usage" }}
    >
      <div className="space-y-8">
        <StatRow stats={stats} />

        <Card bare>
          <div className="px-6 pt-5">
            <CardHeader title="Daily spend" description="Last 30 days" />
          </div>
          <div className="px-6 pb-5">
            <Sparkline
              data={series.map((d) => ({ date: d.date, value: d.costMicroUsd }))}
            />
            <div className="mt-2 flex justify-between text-[11px] text-fg-subtle font-mono tabular-nums">
              <span>{series[0]?.date ?? ""}</span>
              <span>{series[series.length - 1]?.date ?? ""}</span>
            </div>
          </div>
        </Card>

        <div className="grid gap-6 sm:grid-cols-2">
          <SimpleList
            title="By member"
            items={members.map((m) => ({
              id: m.userId,
              label: m.label,
              value: fmtUsd(m.costMicroUsd),
            }))}
            emptyText="No team spend yet."
          />
          <SimpleList
            title="By agent"
            items={breakdown.map((a) => ({
              id: a.agentConfigId,
              label: a.agentName,
              value: fmtUsd(a.costMicroUsd),
            }))}
            emptyText="No spend yet."
          />
        </div>

        <SimpleList
          title="Top sessions"
          items={topSessions.map((s) => ({
            id: s.sessionId,
            label: s.title,
            value: fmtUsd(s.costMicroUsd),
            href: `/sessions/${s.sessionId}`,
          }))}
          emptyText="No sessions with spend."
        />
      </div>
    </AppShell>
  );
}

function SimpleList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: Array<{ id: string; label: string; value: string; href?: string }>;
  emptyText: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-medium text-fg tracking-tight px-1">
        {title}
      </h2>
      {items.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {items.map((it) => {
            const inner = (
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="text-[14px] text-fg truncate">{it.label}</span>
                <span className="text-[14px] font-mono tabular-nums text-fg-muted shrink-0">
                  {it.value}
                </span>
              </div>
            );
            return (
              <li key={it.id}>
                {it.href ? (
                  <Link
                    href={it.href}
                    className="block hover:bg-surface-2/60 transition-colors duration-150"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
