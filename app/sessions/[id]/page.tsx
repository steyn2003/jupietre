import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { GitBranchIcon } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db/client";
import { sessionMessages, sessions } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { loadReadableSession } from "@/lib/auth/authz";
import { getAgentConfigById } from "@/lib/db/agent-configs";
import { listPendingApprovalsForSession } from "@/lib/db/approvals";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { SessionChat } from "./session-chat";
import { DeleteSessionButton } from "./delete-button";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const row = await loadReadableSession(id, session.userId);
  if (!row) notFound();

  const history = await db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, id))
    .orderBy(asc(sessionMessages.indexInSession));

  const agent = await getAgentConfigById(row.agentConfigId);
  const agentLabel = agent?.name ?? "Agent";

  const pending = await listPendingApprovalsForSession(id);
  const timeoutSeconds = agent?.approvalTimeoutSeconds ?? 300;

  let parentInfo: { id: string; title: string } | null = null;
  if (row.parentSessionId) {
    const parent = (
      await db
        .select({ id: sessions.id, title: sessions.title })
        .from(sessions)
        .where(eq(sessions.id, row.parentSessionId))
        .limit(1)
    )[0];
    if (parent) parentInfo = parent;
  }

  const ownerId = row.ownerId ?? row.userId;
  const isOwner = ownerId === session.userId;

  return (
    <AppShell
      email={session.email}
      fluid
      back={{ href: "/", label: "Sessions" }}
    >
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="neutral">{agentLabel}</Badge>
          <Badge tone="neutral">
            <span className="font-mono normal-case">
              {row.repoLabel ?? row.repoPath}
            </span>
          </Badge>
          {row.baseBranch ? (
            <Badge tone="neutral">
              <span className="font-mono normal-case">
                ↳ origin/{row.baseBranch}
              </span>
            </Badge>
          ) : null}
          {row.visibility === "team" ? <Badge tone="accent">Team</Badge> : null}
        </div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-[24px] sm:text-[28px] font-medium text-fg tracking-tight leading-[1.15]">
            {row.title}
          </h1>
          {isOwner ? <DeleteSessionButton sessionId={row.id} /> : null}
        </div>
        {parentInfo ? (
          <div className="flex items-center gap-1.5 text-[12px] text-fg-muted">
            <GitBranchIcon weight="regular" className="h-3.5 w-3.5" />
            forked from{" "}
            <Link
              href={`/sessions/${parentInfo.id}`}
              className="text-fg hover:text-accent transition-colors"
            >
              {parentInfo.title}
            </Link>
            {row.forkedAtMessageIndex !== null
              ? ` · turn ${row.forkedAtMessageIndex}`
              : ""}
          </div>
        ) : null}
      </div>

      <SessionChat
        sessionId={row.id}
        initialMessages={history.map((m) => ({
          id: m.id,
          kind: m.kind,
          text: m.text,
          createdAt: m.createdAt.toISOString(),
          indexInSession: m.indexInSession,
        }))}
        initialStatus={row.status}
        initialPendingApprovals={pending.map((a) => ({
          id: a.id,
          toolName: a.toolName,
          args: a.args,
          timeoutSeconds,
          expiresAt: a.createdAt.getTime() + timeoutSeconds * 1000,
        }))}
      />
    </AppShell>
  );
}
