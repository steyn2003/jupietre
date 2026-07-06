import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import {
  agentConfigs,
  agentSchedules,
  connections,
  eventDeliveries,
  eventSubscriptions,
  events,
  linearPollerRules,
  linearPollers,
  repos,
  sessions,
  teamMembers,
  usageEvents,
  webhooks,
} from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import {
  getMyTeamIds,
  visibleAgentsWhere,
  visibleConnectionsWhere,
  visibleReposWhere,
  visibleSessionsWhere,
} from "@/lib/auth/authz";
import { grantsForAgents } from "@/lib/db/connections";

// ────────────────────────────────────────────────────────────────────
// Control-plane graph for the home canvas. Everything is scoped through
// the shared authz visibility helpers (own + team). Kept to a fixed set
// of queries — no per-agent fan-out.
// ────────────────────────────────────────────────────────────────────

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function scheduleSubLabel(hour: number, days: number[] | null): string {
  const when = `${String(hour).padStart(2, "0")}:00`;
  if (!days || days.length === 0 || days.length === 7) return `daily ${when}`;
  const list = [...days].sort((a, b) => a - b).map((d) => DAY_ABBR[d] ?? d).join(" ");
  return `${list} · ${when}`;
}

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.userId;
  const myTeamIds = await getMyTeamIds(userId);

  // Team roles → the set of teams where I'm an owner (drives canEdit without
  // an isTeamOwner call per agent).
  const memberships = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  const ownerTeamIds = new Set(
    memberships.filter((m) => m.role === "owner").map((m) => m.teamId),
  );

  const agentRows = await db
    .select({
      id: agentConfigs.id,
      slug: agentConfigs.slug,
      name: agentConfigs.name,
      model: agentConfigs.model,
      effort: agentConfigs.effort,
      userId: agentConfigs.userId,
      teamId: agentConfigs.teamId,
      selectedSkills: agentConfigs.selectedSkills,
      maxBudgetUsd: agentConfigs.maxBudgetUsd,
      dailyBudgetUsd: agentConfigs.dailyBudgetUsd,
      monthlyBudgetUsd: agentConfigs.monthlyBudgetUsd,
      enableLinearTools: agentConfigs.enableLinearTools,
      enableGithubTools: agentConfigs.enableGithubTools,
      enableAgentTools: agentConfigs.enableAgentTools,
      enableEventTools: agentConfigs.enableEventTools,
    })
    .from(agentConfigs)
    .where(visibleAgentsWhere(userId, myTeamIds));

  const agentIds = agentRows.map((a) => a.id);
  const agentIdSet = new Set(agentIds);

  if (agentIds.length === 0) {
    return Response.json({
      agents: [],
      triggers: [],
      repos: [],
      connections: [],
      delegationEdges: [],
      repoEdges: [],
      grantEdges: [],
      eventTriggers: [],
      emitEdges: [],
      runningSessions: [],
      recentSessions: [],
    });
  }

  const visibleSessions = visibleSessionsWhere(userId, myTeamIds);
  const child = alias(sessions, "child");
  const parent = alias(sessions, "parent");
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // visibleSessionsWhere targets the base `sessions` table; the delegation
  // query reads from aliases, so re-express visibility against `child`.
  const childVisible =
    myTeamIds.length === 0
      ? or(eq(child.ownerId, userId), eq(child.userId, userId))
      : or(
          eq(child.ownerId, userId),
          eq(child.userId, userId),
          and(eq(child.visibility, "team"), inArray(child.teamId, myTeamIds)),
        );

  const [
    runningRows,
    todayCostRows,
    pollerRows,
    scheduleRows,
    repoRows,
    delegationRows,
    repoEdgeRows,
    recentRows,
    connectionRows,
    grantRows,
    subscriptionRows,
    webhookRows,
    runningSubRows,
    emitRows,
  ] = await Promise.all([
    // Currently-running sessions (small) — drives runningCount + edge animation.
    db
      .select({ agentConfigId: sessions.agentConfigId, source: sessions.source })
      .from(sessions)
      .where(and(eq(sessions.status, "running"), visibleSessions)),
    // Today's spend per agent (micro-USD).
    db
      .select({
        agentConfigId: usageEvents.agentConfigId,
        total: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
      })
      .from(usageEvents)
      .where(
        and(
          inArray(usageEvents.agentConfigId, agentIds),
          gte(usageEvents.at, startOfDayUtc()),
        ),
      )
      .groupBy(usageEvents.agentConfigId),
    // Enabled Linear poller rules (poller.enabled=1, visible poller).
    db
      .select({
        ruleId: linearPollerRules.id,
        agentConfigId: linearPollerRules.agentConfigId,
        mode: linearPollerRules.mode,
        pickupState: linearPollerRules.pickupState,
        pollerName: linearPollers.name,
      })
      .from(linearPollerRules)
      .innerJoin(
        linearPollers,
        eq(linearPollers.id, linearPollerRules.pollerId),
      )
      .where(
        and(
          eq(linearPollers.enabled, 1),
          myTeamIds.length === 0
            ? eq(linearPollers.ownerId, userId)
            : or(
                eq(linearPollers.ownerId, userId),
                inArray(linearPollers.teamId, myTeamIds),
              ),
        ),
      ),
    // Enabled schedules.
    db
      .select({
        id: agentSchedules.id,
        name: agentSchedules.name,
        agentConfigId: agentSchedules.agentConfigId,
        repoId: agentSchedules.repoId,
        hour: agentSchedules.hour,
        days: agentSchedules.days,
      })
      .from(agentSchedules)
      .where(
        and(
          eq(agentSchedules.enabled, 1),
          myTeamIds.length === 0
            ? eq(agentSchedules.ownerId, userId)
            : or(
                eq(agentSchedules.ownerId, userId),
                inArray(agentSchedules.teamId, myTeamIds),
              ),
        ),
      ),
    // Managed repos.
    db
      .select({
        id: repos.id,
        slug: repos.slug,
        githubRepo: repos.githubRepo,
      })
      .from(repos)
      .where(visibleReposWhere(userId, myTeamIds)),
    // Live/recent delegation edges (child sessions spawned by an agent).
    db
      .select({
        fromAgentId: parent.agentConfigId,
        toAgentId: child.agentConfigId,
        status: child.status,
      })
      .from(child)
      .innerJoin(parent, eq(parent.id, child.parentSessionId))
      .where(
        and(
          eq(child.source, "agent"),
          isNotNull(child.parentSessionId),
          gte(child.createdAt, dayAgo),
          childVisible,
        ),
      ),
    // Agent → repo wiring from the last 7 days of sessions.
    db
      .select({
        agentConfigId: sessions.agentConfigId,
        repoId: sessions.repoId,
        status: sessions.status,
      })
      .from(sessions)
      .where(
        and(
          isNotNull(sessions.repoId),
          gte(sessions.createdAt, weekAgo),
          visibleSessions,
        ),
      ),
    // Recent sessions for the inspector.
    db
      .select({
        id: sessions.id,
        title: sessions.title,
        status: sessions.status,
        agentConfigId: sessions.agentConfigId,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .where(visibleSessions)
      .orderBy(desc(sessions.updatedAt))
      .limit(15),
    // Visible connections (redacted — no secrets, just identity + kind).
    db
      .select({
        id: connections.id,
        slug: connections.slug,
        name: connections.name,
        kind: connections.kind,
        ownerId: connections.ownerId,
        teamId: connections.teamId,
      })
      .from(connections)
      .where(visibleConnectionsWhere(userId, myTeamIds)),
    // Grants for visible agents. Filtered to visible connections below.
    grantsForAgents(agentIds),
    // Enabled, visible event subscriptions → trigger-style nodes.
    db
      .select({
        id: eventSubscriptions.id,
        agentConfigId: eventSubscriptions.agentConfigId,
        topicPattern: eventSubscriptions.topicPattern,
      })
      .from(eventSubscriptions)
      .where(
        and(
          eq(eventSubscriptions.enabled, 1),
          myTeamIds.length === 0
            ? eq(eventSubscriptions.ownerId, userId)
            : or(
                eq(eventSubscriptions.ownerId, userId),
                inArray(eventSubscriptions.teamId, myTeamIds),
              ),
        ),
      ),
    // Enabled, visible webhooks → source nodes.
    db
      .select({
        id: webhooks.id,
        name: webhooks.name,
        topic: webhooks.topic,
      })
      .from(webhooks)
      .where(
        and(
          eq(webhooks.enabled, 1),
          myTeamIds.length === 0
            ? eq(webhooks.ownerId, userId)
            : or(
                eq(webhooks.ownerId, userId),
                inArray(webhooks.teamId, myTeamIds),
              ),
        ),
      ),
    // Subscriptions with a currently-running triggered session → edge animation.
    db
      .selectDistinct({ subscriptionId: eventDeliveries.subscriptionId })
      .from(eventDeliveries)
      .innerJoin(sessions, eq(sessions.id, eventDeliveries.sessionId))
      .where(and(eq(sessions.status, "running"), visibleSessions)),
    // Agent-emitted events in the last 24h → dim dashed emit edges.
    db
      .selectDistinct({
        agentConfigId: events.sourceAgentConfigId,
        topic: events.topic,
      })
      .from(events)
      .where(
        and(
          eq(events.source, "agent"),
          isNotNull(events.sourceAgentConfigId),
          gte(events.createdAt, dayAgo),
          myTeamIds.length === 0
            ? eq(events.ownerId, userId)
            : or(
                eq(events.ownerId, userId),
                inArray(events.teamId, myTeamIds),
              ),
        ),
      ),
  ]);

  const runningCount = new Map<string, number>();
  for (const r of runningRows) {
    runningCount.set(
      r.agentConfigId,
      (runningCount.get(r.agentConfigId) ?? 0) + 1,
    );
  }

  const todayCost = new Map<string, number>();
  for (const r of todayCostRows) {
    todayCost.set(r.agentConfigId, Number(r.total) / 1_000_000);
  }

  const agents = agentRows.map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    model: a.model,
    effort: a.effort,
    enableLinearTools: a.enableLinearTools,
    enableGithubTools: a.enableGithubTools,
    enableAgentTools: a.enableAgentTools,
    enableEventTools: a.enableEventTools,
    selectedSkillsCount:
      a.selectedSkills === null
        ? ("all" as const)
        : a.selectedSkills.length,
    maxBudgetUsd: a.maxBudgetUsd,
    dailyBudgetUsd: a.dailyBudgetUsd,
    monthlyBudgetUsd: a.monthlyBudgetUsd,
    runningCount: runningCount.get(a.id) ?? 0,
    todayCostUsd: todayCost.get(a.id) ?? 0,
    canEdit:
      (a.userId === userId && a.teamId === null) ||
      (a.teamId !== null && ownerTeamIds.has(a.teamId)),
  }));

  const triggers = [
    ...pollerRows
      .filter((r) => agentIdSet.has(r.agentConfigId))
      .map((r) => ({
        id: `poller:${r.ruleId}`,
        kind: "linear" as const,
        label: `Linear · ${r.pollerName}`,
        subLabel: `${r.pickupState} → ${r.mode}`,
        agentConfigId: r.agentConfigId,
        href: "/pollers",
      })),
    ...scheduleRows
      .filter((r) => agentIdSet.has(r.agentConfigId))
      .map((r) => ({
        id: `schedule:${r.id}`,
        kind: "schedule" as const,
        label: `Schedule · ${r.name}`,
        subLabel: scheduleSubLabel(r.hour, r.days),
        agentConfigId: r.agentConfigId,
        href: "/schedules",
      })),
  ];

  // Delegation edges — dedupe (from,to), running = any child running.
  const delegationMap = new Map<
    string,
    { fromAgentId: string; toAgentId: string; running: boolean }
  >();
  for (const d of delegationRows) {
    if (!d.fromAgentId || !d.toAgentId || d.fromAgentId === d.toAgentId) continue;
    if (!agentIdSet.has(d.fromAgentId) || !agentIdSet.has(d.toAgentId)) continue;
    const key = `${d.fromAgentId}->${d.toAgentId}`;
    const prev = delegationMap.get(key);
    const running = d.status === "running";
    if (prev) prev.running = prev.running || running;
    else delegationMap.set(key, { fromAgentId: d.fromAgentId, toAgentId: d.toAgentId, running });
  }

  // Repo edges — sessions (last 7d) + schedules that pin a repo.
  const repoEdgeMap = new Map<
    string,
    { agentConfigId: string; repoId: string; running: boolean }
  >();
  const repoIdSet = new Set(repoRows.map((r) => r.id));
  function addRepoEdge(agentConfigId: string, repoId: string, running: boolean) {
    if (!agentIdSet.has(agentConfigId) || !repoIdSet.has(repoId)) return;
    const key = `${agentConfigId}@${repoId}`;
    const prev = repoEdgeMap.get(key);
    if (prev) prev.running = prev.running || running;
    else repoEdgeMap.set(key, { agentConfigId, repoId, running });
  }
  for (const e of repoEdgeRows) {
    if (!e.repoId) continue;
    addRepoEdge(e.agentConfigId, e.repoId, e.status === "running");
  }
  for (const s of scheduleRows) {
    if (s.repoId) addRepoEdge(s.agentConfigId, s.repoId, false);
  }

  // Connections (redacted) + grant edges. canEdit mirrors the agent rule:
  // own private connection, or a team connection where I'm a team owner.
  const connectionsOut = connectionRows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    canEdit:
      (c.ownerId === userId && c.teamId === null) ||
      (c.teamId !== null && ownerTeamIds.has(c.teamId)),
  }));
  const connectionIdSet = new Set(connectionsOut.map((c) => c.id));

  const grantEdges = grantRows
    .filter(
      (g) =>
        agentIdSet.has(g.agentConfigId) &&
        connectionIdSet.has(g.connectionId),
    )
    .map((g) => ({
      connectionId: g.connectionId,
      agentConfigId: g.agentConfigId,
    }));

  // Event bus nodes. Subscriptions become trigger-style nodes wired to their
  // agent (edge animates when a triggered session is running). Webhooks become
  // source nodes; the canvas wires their dim edges to matching subscriptions.
  const agentNameById = new Map(agentRows.map((a) => [a.id, a.name]));
  const runningSubIds = new Set(runningSubRows.map((r) => r.subscriptionId));
  const eventTriggers = [
    ...subscriptionRows
      .filter((s) => agentIdSet.has(s.agentConfigId))
      .map((s) => ({
        id: `sub:${s.id}`,
        kind: "subscription" as const,
        label: `Event · ${s.topicPattern}`,
        subLabel: `→ ${agentNameById.get(s.agentConfigId) ?? "agent"}`,
        agentConfigId: s.agentConfigId,
        topic: s.topicPattern,
        running: runningSubIds.has(s.id),
      })),
    ...webhookRows.map((w) => ({
      id: `hook:${w.id}`,
      kind: "webhook" as const,
      label: `Hook · ${w.name}`,
      subLabel: `→ ${w.topic}`,
      agentConfigId: null,
      topic: w.topic,
      running: false,
    })),
  ];

  // Emit edges — dedupe already done by selectDistinct; drop null agent ids
  // and non-visible agents. Canvas skips any topic with no matching sub.
  const emitEdges = emitRows
    .filter(
      (e): e is { agentConfigId: string; topic: string } =>
        e.agentConfigId !== null && agentIdSet.has(e.agentConfigId),
    )
    .map((e) => ({ agentConfigId: e.agentConfigId, topic: e.topic }));

  return Response.json({
    agents,
    triggers,
    repos: repoRows,
    connections: connectionsOut,
    delegationEdges: [...delegationMap.values()],
    repoEdges: [...repoEdgeMap.values()],
    grantEdges,
    eventTriggers,
    emitEdges,
    runningSessions: runningRows,
    recentSessions: recentRows,
  });
}
