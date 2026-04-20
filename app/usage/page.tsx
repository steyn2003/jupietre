import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { getServerSession } from "@/lib/auth/session";
import { listTeamsForUser } from "@/lib/db/teams";
import {
  getAgentBreakdown,
  getDailySpendSeries,
  getTopSessions,
  getUserSpendWindow,
  microUsdToUsd,
} from "@/lib/db/usage";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatRow, type Stat } from "@/components/ui/StatRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sparkline } from "./sparkline";

function fmtUsd(micro: number): string {
  return `$${microUsdToUsd(micro).toFixed(2)}`;
}

export default async function UsagePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [today, month, series, breakdown, topSessions, myTeams] =
    await Promise.all([
      getUserSpendWindow(session.userId, "day"),
      getUserSpendWindow(session.userId, "month"),
      getDailySpendSeries({ userId: session.userId, days: 30 }),
      getAgentBreakdown({ userId: session.userId, days: 30 }),
      getTopSessions({ userId: session.userId, days: 30, limit: 5 }),
      listTeamsForUser(session.userId),
    ]);

  const total30 = series.reduce((sum, d) => sum + d.costMicroUsd, 0);
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
      eyebrow="Spend"
      title="Usage"
      description={
        <>
          Cost figures come from the Claude Agent SDK&apos;s{" "}
          <code className="font-mono text-fg">total_cost_usd</code> on each
          turn.
        </>
      }
      action={
        myTeams.length > 0 ? (
          <Link
            href="/usage/team"
            className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg transition-colors"
          >
            Team usage
            <ArrowRightIcon weight="bold" className="h-3.5 w-3.5" />
          </Link>
        ) : null
      }
    >
      <div className="space-y-8">
        <StatRow stats={stats} />

        <Card bare>
          <div className="px-6 pt-5">
            <CardHeader
              title="Daily spend"
              description="Last 30 days"
              action={
                <span className="text-[11px] text-fg-subtle font-mono tabular-nums">
                  peak {fmtUsd(peak)}
                </span>
              }
            />
          </div>
          <div className="px-6">
            <Sparkline
              data={series.map((d) => ({ date: d.date, value: d.costMicroUsd }))}
            />
            <div className="mt-2 flex justify-between text-[11px] text-fg-subtle font-mono tabular-nums pb-5">
              <span>{series[0]?.date ?? ""}</span>
              <span>{series[series.length - 1]?.date ?? ""}</span>
            </div>
          </div>
        </Card>

        <BreakdownList
          title="By agent"
          description="30 days"
          items={breakdown.map((a) => ({
            id: a.agentConfigId,
            label: a.agentName,
            sub: `${a.events} events`,
            value: fmtUsd(a.costMicroUsd),
          }))}
          emptyText="No spend yet."
        />

        <BreakdownList
          title="Top sessions"
          description="30 days"
          items={topSessions.map((s) => ({
            id: s.sessionId,
            label: s.title,
            href: `/sessions/${s.sessionId}`,
            value: fmtUsd(s.costMicroUsd),
          }))}
          emptyText="No sessions with spend."
        />
      </div>
    </AppShell>
  );
}

function BreakdownList({
  title,
  description,
  items,
  emptyText,
}: {
  title: string;
  description?: string;
  items: Array<{
    id: string;
    label: string;
    value: string;
    sub?: string;
    href?: string;
  }>;
  emptyText: string;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between px-1">
        <div>
          <h2 className="text-[13px] font-medium text-fg tracking-tight">
            {title}
          </h2>
          {description ? (
            <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle mt-0.5">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {items.map((it) => {
            const inner = (
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="text-[14px] text-fg truncate">{it.label}</div>
                  {it.sub ? (
                    <div className="text-[11px] text-fg-subtle font-mono tabular-nums mt-0.5">
                      {it.sub}
                    </div>
                  ) : null}
                </div>
                <div className="text-[14px] font-mono tabular-nums text-fg-muted shrink-0">
                  {it.value}
                </div>
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
