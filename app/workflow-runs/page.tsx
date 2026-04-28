import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import { listVisibleRuns } from "@/lib/workflows/runs";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

const statusVariant: Record<string, string> = {
  running: "bg-blue-500/10 text-blue-600 dark:text-blue-300 ring-blue-500/30",
  awaiting:
    "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  done: "bg-green-500/10 text-green-700 dark:text-green-300 ring-green-500/30",
  error: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
};

export default async function WorkflowRunsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const runs = await listVisibleRuns(session.userId, myTeamIds);

  return (
    <AppShell
      email={session.email}
      eyebrow="Workflows"
      title="Runs"
      description="Every workflow run you have access to. Click a row to open its live graph + message log."
      action={
        <Link href="/workflows">
          <Button variant="secondary">Workflows</Button>
        </Link>
      }
    >
      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Start a run from the Workflows page — pick a workflow, pick a repo, write the goal."
          action={
            <Link href="/workflows">
              <Button>Go to Workflows</Button>
            </Link>
          }
        />
      ) : (
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {runs.map((r) => {
            const ctx = r.contextJson as Record<string, unknown>;
            const goal =
              typeof ctx.goal === "string"
                ? ctx.goal.length > 120
                  ? ctx.goal.slice(0, 120) + "…"
                  : ctx.goal
                : "(no goal)";
            return (
              <li key={r.id}>
                <Link
                  href={`/workflow-runs/${r.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {r.workflowName}
                      </span>
                      <code className="text-[11px] text-fg-subtle">
                        {r.id.slice(0, 8)}
                      </code>
                      <span className="text-[11px] text-fg-subtle">
                        @ <code>{r.currentNode}</code>
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-fg-subtle truncate">
                      {goal}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center rounded-full px-2.5 h-6 text-[11px] font-medium ring-1 ${
                      statusVariant[r.status] ?? ""
                    }`}
                  >
                    {r.status}
                  </span>
                  <time
                    className="hidden sm:block shrink-0 text-[11px] text-fg-subtle tabular-nums"
                    dateTime={r.createdAt.toISOString()}
                    title={r.createdAt.toISOString()}
                  >
                    {timeAgo(r.createdAt)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}

function timeAgo(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const s = Math.round(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}
