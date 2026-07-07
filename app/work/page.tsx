import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  ListChecksIcon,
  ArrowSquareOutIcon,
  GitCommitIcon,
} from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db/client";
import {
  agentConfigs,
  sessionArtifacts,
  sessions,
  toolApprovalRequests,
} from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleSessionsWhere } from "@/lib/auth/authz";
import { listVisibleRuns } from "@/lib/workflows/runs";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/components/ui/cn";

// ────────────────────────────────────────────────────────────────────
// Mission Control (M13). One ledger over everything the OS is doing:
// standalone sessions + workflow runs, each with where it came from,
// who's on it, what state it's in, and what shipped. Pure query —
// no new tables; sessions/runs/approvals/artifacts already carry it all.
// ────────────────────────────────────────────────────────────────────

type WorkState = "running" | "approval" | "awaiting" | "error" | "done" | "idle";

interface WorkItem {
  key: string;
  href: string;
  title: string;
  subtitle: string;
  origin: string;
  originTone: "accent" | "neutral";
  state: WorkState;
  prs: Array<{ url: string | null; title: string }>;
  commits: number;
  teamShared: boolean;
  updatedAt: Date;
}

const stateLabel: Record<WorkState, string> = {
  running: "running",
  approval: "needs approval",
  awaiting: "awaiting",
  error: "error",
  done: "done",
  idle: "idle",
};

const stateTone: Record<WorkState, "accent" | "success" | "warning" | "danger" | "neutral"> = {
  running: "accent",
  approval: "warning",
  awaiting: "warning",
  error: "danger",
  done: "success",
  idle: "neutral",
};

const originLabel: Record<string, string> = {
  ui: "Manual",
  linear: "Linear",
  workflow: "Workflow",
  agent: "Agent",
  schedule: "Schedule",
  event: "Event",
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "attention", label: "Needs attention" },
  { key: "done", label: "Done" },
] as const;

const ACTIVE_STATES: WorkState[] = ["running", "awaiting", "approval"];
const ATTENTION_STATES: WorkState[] = ["error", "approval"];

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { f } = await searchParams;
  const filter = FILTERS.some((x) => x.key === f) ? (f as string) : "all";

  const myTeamIds = await getMyTeamIds(session.userId);

  // Standalone sessions (workflow-run children fold under their run below).
  const sessionRows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      source: sessions.source,
      linearIssueId: sessions.linearIssueId,
      repoLabel: sessions.repoLabel,
      status: sessions.status,
      visibility: sessions.visibility,
      updatedAt: sessions.updatedAt,
      agentName: agentConfigs.name,
    })
    .from(sessions)
    .leftJoin(agentConfigs, eq(agentConfigs.id, sessions.agentConfigId))
    .where(
      and(
        visibleSessionsWhere(session.userId, myTeamIds),
        isNull(sessions.workflowRunId),
      ),
    )
    .orderBy(desc(sessions.updatedAt))
    .limit(150);

  const runs = await listVisibleRuns(session.userId, myTeamIds);

  // Children of visible runs — for rolling approvals + artifacts up to the run.
  const runIds = runs.map((r) => r.id);
  const children = runIds.length
    ? await db
        .select({ id: sessions.id, workflowRunId: sessions.workflowRunId })
        .from(sessions)
        .where(inArray(sessions.workflowRunId, runIds))
    : [];
  const childToRun = new Map(children.map((c) => [c.id, c.workflowRunId as string]));

  const allSessionIds = [...sessionRows.map((s) => s.id), ...children.map((c) => c.id)];

  const pendingApprovals = allSessionIds.length
    ? await db
        .select({ sessionId: toolApprovalRequests.sessionId })
        .from(toolApprovalRequests)
        .where(
          and(
            eq(toolApprovalRequests.status, "pending"),
            inArray(toolApprovalRequests.sessionId, allSessionIds),
          ),
        )
    : [];
  const approvalSessionIds = new Set(pendingApprovals.map((a) => a.sessionId));

  const artifacts = allSessionIds.length
    ? await db
        .select({
          sessionId: sessionArtifacts.sessionId,
          kind: sessionArtifacts.kind,
          url: sessionArtifacts.url,
          title: sessionArtifacts.title,
          createdAt: sessionArtifacts.createdAt,
        })
        .from(sessionArtifacts)
        .where(
          and(
            inArray(sessionArtifacts.kind, ["pr", "commit"]),
            inArray(sessionArtifacts.sessionId, allSessionIds),
          ),
        )
    : [];

  // Bucket artifacts by owning work item (session id, or run id for children).
  const outcomes = new Map<string, { prs: Array<{ url: string | null; title: string }>; commits: number }>();
  const bucket = (key: string) => {
    let b = outcomes.get(key);
    if (!b) {
      b = { prs: [], commits: 0 };
      outcomes.set(key, b);
    }
    return b;
  };
  let prsThisWeek = 0;
  const weekAgo = Date.now() - 7 * 86_400_000;
  for (const a of artifacts) {
    const key = childToRun.get(a.sessionId) ?? a.sessionId;
    const b = bucket(key);
    if (a.kind === "pr") {
      b.prs.push({ url: a.url, title: a.title });
      if (a.createdAt.getTime() >= weekAgo) prsThisWeek++;
    } else {
      b.commits++;
    }
  }

  const items: WorkItem[] = [];

  for (const s of sessionRows) {
    const state: WorkState =
      s.status === "error"
        ? "error"
        : approvalSessionIds.has(s.id)
          ? "approval"
          : s.status === "running"
            ? "running"
            : "idle";
    const o = outcomes.get(s.id);
    items.push({
      key: `s-${s.id}`,
      href: `/sessions/${s.id}`,
      title: s.title,
      subtitle: [s.agentName ?? "Agent", s.repoLabel].filter(Boolean).join(" · "),
      origin: s.source === "linear" && s.linearIssueId
        ? s.linearIssueId
        : (originLabel[s.source] ?? s.source),
      originTone: s.source === "ui" ? "neutral" : "accent",
      state,
      prs: o?.prs ?? [],
      commits: o?.commits ?? 0,
      teamShared: s.visibility === "team",
      updatedAt: s.updatedAt,
    });
  }

  const runHasApproval = new Set(
    [...approvalSessionIds].map((id) => childToRun.get(id)).filter(Boolean),
  );
  for (const r of runs) {
    const ctx = r.contextJson as Record<string, unknown>;
    const goal = typeof ctx.goal === "string" ? ctx.goal : "";
    const state: WorkState =
      r.status === "error"
        ? "error"
        : r.status === "done"
          ? "done"
          : runHasApproval.has(r.id)
            ? "approval"
            : r.status === "awaiting"
              ? "awaiting"
              : "running";
    const o = outcomes.get(r.id);
    items.push({
      key: `r-${r.id}`,
      href: `/workflow-runs/${r.id}`,
      title: r.workflowName,
      subtitle: goal ? (goal.length > 110 ? goal.slice(0, 110) + "…" : goal) : `@ ${r.currentNode}`,
      origin: "Workflow",
      originTone: "accent",
      state,
      prs: o?.prs ?? [],
      commits: o?.commits ?? 0,
      teamShared: r.teamId != null,
      updatedAt: r.updatedAt,
    });
  }

  items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const activeCount = items.filter((i) => ACTIVE_STATES.includes(i.state)).length;
  const attentionCount = items.filter((i) => ATTENTION_STATES.includes(i.state)).length;

  const visible = items.filter((i) => {
    if (filter === "active") return ACTIVE_STATES.includes(i.state);
    if (filter === "attention") return ATTENTION_STATES.includes(i.state);
    if (filter === "done") return i.state === "done" || i.prs.length > 0;
    return true;
  });

  return (
    <AppShell
      email={session.email}
      eyebrow="Workspace"
      title="Work"
      description="Everything in flight and everything shipped — sessions and workflow runs, where they came from, and what came out."
    >
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-[13px] text-fg-muted">
          <span className="font-semibold text-fg tabular-nums">{activeCount}</span> active
          <span className="mx-2 text-fg-subtle">·</span>
          <span className={cn("font-semibold tabular-nums", attentionCount > 0 ? "text-[var(--danger)]" : "text-fg")}>
            {attentionCount}
          </span>{" "}
          need attention
          <span className="mx-2 text-fg-subtle">·</span>
          <span className="font-semibold text-fg tabular-nums">{prsThisWeek}</span> PRs this week
        </p>
        <nav className="flex items-center gap-1.5">
          {FILTERS.map((fl) => (
            <Link
              key={fl.key}
              href={fl.key === "all" ? "/work" : `/work?f=${fl.key}`}
              className={cn(
                "inline-flex h-7 items-center rounded-full px-3 text-[12px] font-medium ring-1 transition-colors",
                filter === fl.key
                  ? "bg-surface-2 text-fg ring-hairline"
                  : "text-fg-muted ring-transparent hover:text-fg hover:bg-surface-2/60",
              )}
            >
              {fl.label}
            </Link>
          ))}
        </nav>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<ListChecksIcon weight="regular" className="h-5 w-5" />}
          title={filter === "all" ? "Nothing in the ledger yet" : "Nothing here"}
          description={
            filter === "all"
              ? "Work shows up here as sessions start and workflows run — from the UI, Linear, schedules, or events."
              : "No items match this filter right now."
          }
        />
      ) : (
        <WorkGroups items={visible} />
      )}
    </AppShell>
  );
}

function WorkGroups({ items }: { items: WorkItem[] }) {
  const groups = groupByDate(items);
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.label} className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle font-medium px-1">
            {g.label}
          </h2>
          <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
            {g.items.map((it) => (
              <li key={it.key} className="relative">
                {/* Stretched link keeps the whole row clickable while PR chips
                    stay independent anchors (nested <a> is invalid HTML). */}
                <Link href={it.href} className="absolute inset-0" aria-label={it.title} />
                <div className="flex items-center gap-4 px-5 py-4 hover:bg-surface-2/60 transition-colors duration-150">
                  <StatusDot state={it.state} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="truncate text-[14px] font-medium text-fg">
                        {it.title}
                      </span>
                      <Badge tone={it.originTone}>{it.origin}</Badge>
                      {it.teamShared ? <Badge>Team</Badge> : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-fg-muted">
                      <span className="truncate">{it.subtitle}</span>
                      {it.commits > 0 ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-fg-subtle">
                          <GitCommitIcon className="h-3.5 w-3.5" />
                          {it.commits}
                        </span>
                      ) : null}
                      {it.prs.slice(0, 2).map((pr, i) =>
                        pr.url ? (
                          <a
                            key={i}
                            href={pr.url}
                            target="_blank"
                            rel="noreferrer"
                            className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 h-5 text-[11px] font-medium text-fg-muted ring-1 ring-hairline hover:text-fg transition-colors"
                          >
                            PR
                            <ArrowSquareOutIcon className="h-3 w-3" />
                          </a>
                        ) : null,
                      )}
                    </div>
                  </div>
                  <Badge tone={stateTone[it.state]} dot>
                    {stateLabel[it.state]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StatusDot({ state }: { state: WorkState }) {
  const color =
    state === "running"
      ? "var(--accent)"
      : state === "error"
        ? "var(--danger)"
        : state === "done"
          ? "var(--success)"
          : state === "approval" || state === "awaiting"
            ? "var(--warning, #d97706)"
            : "var(--fg-subtle)";
  return (
    <span
      aria-hidden
      className="relative h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    >
      {state === "running" || state === "approval" ? (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ background: color, opacity: 0.45 }}
        />
      ) : null}
    </span>
  );
}

/* Same Today / Yesterday / This week / Earlier bucketing as /sessions. */
function groupByDate(items: WorkItem[]): Array<{ label: string; items: WorkItem[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86_400_000);

  const today: WorkItem[] = [];
  const yesterday: WorkItem[] = [];
  const thisWeek: WorkItem[] = [];
  const earlier: WorkItem[] = [];

  for (const it of items) {
    const t = it.updatedAt.getTime();
    if (t >= startOfToday.getTime()) today.push(it);
    else if (t >= startOfYesterday.getTime()) yesterday.push(it);
    else if (t >= startOfWeek.getTime()) thisWeek.push(it);
    else earlier.push(it);
  }

  return [
    { label: "Today", items: today },
    { label: "Yesterday", items: yesterday },
    { label: "This week", items: thisWeek },
    { label: "Earlier", items: earlier },
  ].filter((g) => g.items.length > 0);
}
