import { and, desc, eq } from "drizzle-orm";
import { LinearClient } from "@linear/sdk";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleSessionsWhere } from "@/lib/auth/authz";
import { db } from "@/lib/db/client";
import {
  agentConfigs,
  linearPollers,
  sessionMessages,
  sessions,
} from "@/lib/db/schema";
import { recordArtifact } from "@/lib/db/artifacts";

/**
 * Promote a Scout run's report into a Linear ticket. On-demand only — Scout
 * never files tickets itself. The created issue ALWAYS carries a label named
 * after the run's repo (created in Linear if it doesn't exist yet), so the
 * engineer poller — which routes by repo label — can pick it up.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { sessionId?: unknown };
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  if (!sessionId)
    return Response.json({ error: "sessionId required" }, { status: 400 });

  // Must be a visible Scout run with a repo label to use as the Linear label.
  const myTeamIds = await getMyTeamIds(session.userId);
  const row = (
    await db
      .select({
        id: sessions.id,
        title: sessions.title,
        repoLabel: sessions.repoLabel,
      })
      .from(sessions)
      .innerJoin(agentConfigs, eq(agentConfigs.id, sessions.agentConfigId))
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(agentConfigs.slug, "scout"),
          visibleSessionsWhere(session.userId, myTeamIds),
        ),
      )
      .limit(1)
  )[0];
  if (!row)
    return Response.json({ error: "Scout run not found" }, { status: 404 });
  if (!row.repoLabel)
    return Response.json(
      { error: "Run has no repo label to tag the ticket with" },
      { status: 400 },
    );

  // The report = the run's last assistant message.
  const report = (
    await db
      .select({ text: sessionMessages.text })
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.sessionId, sessionId),
          eq(sessionMessages.kind, "assistant"),
        ),
      )
      .orderBy(desc(sessionMessages.indexInSession))
      .limit(1)
  )[0];
  if (!report?.text)
    return Response.json(
      { error: "No report on this run yet" },
      { status: 400 },
    );

  // Resolve a Linear workspace: prefer an enabled poller owned by this user,
  // then any enabled poller, then the env key.
  const poller =
    (
      await db
        .select({ apiKey: linearPollers.apiKey, teamKey: linearPollers.teamKey })
        .from(linearPollers)
        .where(
          and(
            eq(linearPollers.enabled, 1),
            eq(linearPollers.ownerId, session.userId),
          ),
        )
        .limit(1)
    )[0] ??
    (
      await db
        .select({ apiKey: linearPollers.apiKey, teamKey: linearPollers.teamKey })
        .from(linearPollers)
        .where(eq(linearPollers.enabled, 1))
        .limit(1)
    )[0];

  const apiKey = poller?.apiKey ?? process.env.LINEAR_API_KEY;
  if (!apiKey)
    return Response.json(
      { error: "No Linear API key — add a poller in /pollers or set LINEAR_API_KEY" },
      { status: 400 },
    );

  const client = new LinearClient({ apiKey });

  try {
    // Pick the team: poller's configured key, else the first team the key sees.
    let team;
    if (poller?.teamKey) {
      team = (
        await client.teams({ filter: { key: { eq: poller.teamKey } } })
      ).nodes[0];
    }
    if (!team) team = (await client.teams({ first: 1 })).nodes[0];
    if (!team)
      return Response.json(
        { error: "No Linear team accessible to this API key" },
        { status: 400 },
      );

    // Ensure the repo label exists on the team, then attach it.
    const labelName = row.repoLabel;
    const existing = (await team.labels()).nodes.find(
      (l) => l.name.toLowerCase() === labelName.toLowerCase(),
    );
    let labelId = existing?.id;
    if (!labelId) {
      const created = await client.createIssueLabel({
        teamId: team.id,
        name: labelName,
      });
      labelId = (await created.issueLabel)?.id;
    }

    const title = `Scout improvements — ${labelName}`;
    const description = [
      report.text,
      "",
      "---",
      `_Filed from Scout run \`${sessionId}\`. Labelled \`${labelName}\` for engineer pickup._`,
    ].join("\n");

    const result = await client.createIssue({
      title,
      description,
      teamId: team.id,
      labelIds: labelId ? [labelId] : undefined,
    });
    const issue = await result.issue;

    if (issue) {
      await recordArtifact({
        sessionId,
        kind: "linear_issue",
        title,
        url: issue.url,
        externalId: issue.id,
      });
    }

    return Response.json({
      ok: true,
      url: issue?.url ?? null,
      identifier: issue?.identifier ?? null,
    });
  } catch (err) {
    console.error("[scout] ticket creation failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Linear request failed" },
      { status: 500 },
    );
  }
}
