import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getServerSession } from "@/lib/auth/session";
import { canUseWorkflow, getMyTeamIds } from "@/lib/auth/authz";
import { db } from "@/lib/db/client";
import { agentConfigs, sessions } from "@/lib/db/schema";
import {
  getRun,
  getWorkflow,
  listMessagesForRun,
} from "@/lib/workflows/runs";
import { parseWorkflowDefinition } from "@/lib/workflows/definitions";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { RunGraph } from "./run-graph";

const kindEmoji: Record<string, string> = {
  trigger: "🚀",
  handoff: "➡️",
  ask: "❓",
  answer: "💬",
  reject: "❌",
  complete: "✅",
};

const statusVariant: Record<string, string> = {
  running: "bg-blue-500/10 text-blue-600 dark:text-blue-300 ring-blue-500/30",
  awaiting:
    "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  done: "bg-green-500/10 text-green-700 dark:text-green-300 ring-green-500/30",
  error: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
};

export default async function WorkflowRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();
  const workflow = await getWorkflow(run.workflowId);
  if (!workflow) notFound();
  const myTeamIds = await getMyTeamIds(session.userId);
  if (
    !canUseWorkflow(
      session.userId,
      { ownerId: workflow.ownerId, teamId: workflow.teamId },
      new Set(myTeamIds),
    )
  ) {
    notFound();
  }

  const [messages, runSessions] = await Promise.all([
    listMessagesForRun(runId),
    db
      .select({
        id: sessions.id,
        title: sessions.title,
        workflowNodeSlug: sessions.workflowNodeSlug,
        agentConfigId: sessions.agentConfigId,
        status: sessions.status,
        totalCostUsd: sessions.totalCostUsd,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(eq(sessions.workflowRunId, runId)),
  ]);

  // Parse the definition so the graph view can render every node — including
  // ones that haven't been spawned yet. If the JSON is somehow invalid (e.g.
  // schema got stricter after the row was saved), fall back to a stub so the
  // page still loads with the messages list.
  let definition: ReturnType<typeof parseWorkflowDefinition> | null = null;
  try {
    definition = parseWorkflowDefinition(workflow.definition);
  } catch {
    definition = null;
  }

  // Collect every agent referenced — both by the definition (for the graph,
  // including nodes not yet spawned) and by spawned sessions (defensive in
  // case the definition was edited after the run started).
  const agentIds = Array.from(
    new Set([
      ...runSessions.map((s) => s.agentConfigId),
      ...(definition
        ? Object.values(definition.nodes).map((n) => n.agentConfigId)
        : []),
    ]),
  );
  const agentRows =
    agentIds.length > 0
      ? await db
          .select({ id: agentConfigs.id, name: agentConfigs.name })
          .from(agentConfigs)
      : [];
  const agentName = new Map(agentRows.map((a) => [a.id, a.name]));
  const agentNames: Record<string, string> = Object.fromEntries(agentName);

  const ctx = run.contextJson as Record<string, unknown>;
  const goal = typeof ctx.goal === "string" ? ctx.goal : "(no goal)";
  const errorText = typeof ctx.error === "string" ? ctx.error : null;
  const isTerminal = run.status === "done" || run.status === "error";

  return (
    <AppShell
      email={session.email}
      eyebrow={
        <Link href={`/workflows/${workflow.id}/edit`} className="hover:underline">
          {workflow.name}
        </Link>
      }
      title={`Run ${runId.slice(0, 8)}`}
      description={`Entry at ${run.currentNode}. Messages are the source of truth — sessions are how the agents actually run.`}
      action={
        <span
          className={`inline-flex items-center rounded-full px-3 h-8 text-[12px] font-medium ring-1 ${
            statusVariant[run.status] ?? ""
          }`}
        >
          {run.status}
        </span>
      }
    >
      <div className="space-y-6">
        {errorText ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 px-4 py-3 text-[13px]">
            <strong>Run error:</strong> {errorText}
          </div>
        ) : null}

        {definition ? (
          <RunGraph
            nodes={definition.nodes}
            transitions={definition.transitions}
            sessions={runSessions.map((s) => ({
              id: s.id,
              workflowNodeSlug: s.workflowNodeSlug,
              agentConfigId: s.agentConfigId,
              status: s.status,
              totalCostUsd: s.totalCostUsd,
              createdAt: s.createdAt.toISOString(),
            }))}
            messages={messages.map((m) => ({
              fromNode: m.fromNode,
              toNode: m.toNode,
              kind: m.kind,
              createdAt: m.createdAt.toISOString(),
            }))}
            agentNames={agentNames}
            runStatus={run.status}
            currentNode={run.currentNode}
            livePoll={!isTerminal}
          />
        ) : null}

        <section className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 p-4">
          <div className="text-[12px] uppercase tracking-wide text-fg-subtle">
            Goal
          </div>
          <div className="mt-1 text-[14px] whitespace-pre-wrap">{goal}</div>
        </section>

        <section className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-medium">Messages</div>
            <div className="text-[12px] text-fg-subtle">
              {messages.length} event{messages.length === 1 ? "" : "s"}
            </div>
          </div>
          {messages.length === 0 ? (
            <div className="text-[13px] text-fg-subtle">
              No messages yet — dispatcher will pick up pending messages on the
              next tick.
            </div>
          ) : (
            <ol className="space-y-2">
              {messages.map((m) => {
                const payload = m.payloadJson as Record<string, unknown>;
                const message =
                  typeof payload.message === "string"
                    ? payload.message
                    : typeof payload.text === "string"
                      ? payload.text
                      : typeof payload.goal === "string"
                        ? payload.goal
                        : typeof payload.summary === "string"
                          ? payload.summary
                          : null;
                return (
                  <li
                    key={m.id}
                    className="rounded-lg bg-surface-2/50 p-3 text-[13px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">
                        {kindEmoji[m.kind] ?? "•"}
                      </span>
                      <span className="font-medium">{m.kind}</span>
                      <span className="text-fg-subtle">
                        {m.fromNode ?? "(external)"} → {m.toNode}
                      </span>
                      <span className="ml-auto text-[11px] text-fg-subtle">
                        {m.status} · {new Date(m.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    {message ? (
                      <div className="mt-1 whitespace-pre-wrap text-fg">
                        {message}
                      </div>
                    ) : null}
                    {m.sessionId ? (
                      <div className="mt-1 text-[12px]">
                        <Link
                          href={`/sessions/${m.sessionId}`}
                          className="text-fg-muted hover:underline"
                        >
                          View session →
                        </Link>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 p-4">
          <div className="mb-3 font-medium">Sessions</div>
          {runSessions.length === 0 ? (
            <div className="text-[13px] text-fg-subtle">
              No sessions spawned yet.
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {runSessions.map((s) => (
                <li
                  key={s.id}
                  className="py-2 flex items-center gap-3 text-[13px]"
                >
                  <div className="flex-1 min-w-0 truncate">
                    <Link
                      href={`/sessions/${s.id}`}
                      className="font-medium hover:underline"
                    >
                      {s.title}
                    </Link>
                    <div className="text-[12px] text-fg-subtle">
                      node <code>{s.workflowNodeSlug ?? "?"}</code> ·{" "}
                      {agentName.get(s.agentConfigId) ?? "agent"}
                    </div>
                  </div>
                  <Badge>{s.status}</Badge>
                  <div className="text-[12px] text-fg-subtle tabular-nums">
                    ${Number.parseFloat(s.totalCostUsd ?? "0").toFixed(2)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
