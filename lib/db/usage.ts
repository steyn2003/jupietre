import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { agentConfigs, sessions, usageEvents } from "./schema";

export type UsageEvent = typeof usageEvents.$inferSelect;
type NewUsageEvent = typeof usageEvents.$inferInsert;

export async function recordUsage(
  input: Omit<NewUsageEvent, "id" | "at">,
): Promise<void> {
  await db.insert(usageEvents).values({ ...input, id: nanoid() });
}

function startOfDayUtc(date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfMonthUtc(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Sum micro-USD for a column-value pair within [since, now]. */
async function sumCostSince(
  column: "userId" | "agentConfigId" | "teamId",
  value: string,
  since: Date,
): Promise<number> {
  const col =
    column === "userId"
      ? usageEvents.userId
      : column === "agentConfigId"
        ? usageEvents.agentConfigId
        : usageEvents.teamId;
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
    })
    .from(usageEvents)
    .where(and(eq(col, value), gte(usageEvents.at, since)));
  return Number(rows[0]?.total ?? 0);
}

export async function getAgentSpendWindow(
  agentConfigId: string,
  window: "day" | "month",
): Promise<number> {
  const since = window === "day" ? startOfDayUtc() : startOfMonthUtc();
  return sumCostSince("agentConfigId", agentConfigId, since);
}

export async function getUserSpendWindow(
  userId: string,
  window: "day" | "month",
): Promise<number> {
  const since = window === "day" ? startOfDayUtc() : startOfMonthUtc();
  return sumCostSince("userId", userId, since);
}

export async function getTeamSpendWindow(
  teamId: string,
  window: "day" | "month",
): Promise<number> {
  const since = window === "day" ? startOfDayUtc() : startOfMonthUtc();
  return sumCostSince("teamId", teamId, since);
}

/**
 * Daily cost bucket for the last N days. Missing days are zero.
 * Returns UTC-day → micro-USD in chronological order.
 */
export async function getDailySpendSeries(params: {
  userId?: string;
  teamId?: string;
  days: number;
}): Promise<Array<{ date: string; costMicroUsd: number }>> {
  const { userId, teamId, days } = params;
  const since = new Date(startOfDayUtc().getTime() - (days - 1) * 86_400_000);

  const conditions = [gte(usageEvents.at, since)];
  if (userId) conditions.push(eq(usageEvents.userId, userId));
  if (teamId) conditions.push(eq(usageEvents.teamId, teamId));

  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${usageEvents.at}), 'YYYY-MM-DD')`,
      total: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
    })
    .from(usageEvents)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('day', ${usageEvents.at})`)
    .orderBy(sql`date_trunc('day', ${usageEvents.at})`);

  const map = new Map(rows.map((r) => [r.day, Number(r.total)]));
  const out: Array<{ date: string; costMicroUsd: number }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, costMicroUsd: map.get(key) ?? 0 });
  }
  return out;
}

/** Per-agent breakdown for a user or team over the last `days` days. */
export async function getAgentBreakdown(params: {
  userId?: string;
  teamId?: string;
  days: number;
}): Promise<
  Array<{
    agentConfigId: string;
    agentName: string;
    costMicroUsd: number;
    events: number;
  }>
> {
  const { userId, teamId, days } = params;
  const since = new Date(startOfDayUtc().getTime() - (days - 1) * 86_400_000);
  const conditions = [gte(usageEvents.at, since)];
  if (userId) conditions.push(eq(usageEvents.userId, userId));
  if (teamId) conditions.push(eq(usageEvents.teamId, teamId));

  const rows = await db
    .select({
      agentConfigId: usageEvents.agentConfigId,
      agentName: agentConfigs.name,
      total: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
      events: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .innerJoin(agentConfigs, eq(agentConfigs.id, usageEvents.agentConfigId))
    .where(and(...conditions))
    .groupBy(usageEvents.agentConfigId, agentConfigs.name)
    .orderBy(desc(sql`sum(${usageEvents.costMicroUsd})`));

  return rows.map((r) => ({
    agentConfigId: r.agentConfigId,
    agentName: r.agentName,
    costMicroUsd: Number(r.total),
    events: Number(r.events),
  }));
}

/** Top-N sessions by cost. */
export async function getTopSessions(params: {
  userId?: string;
  teamId?: string;
  days: number;
  limit: number;
}): Promise<
  Array<{
    sessionId: string;
    title: string;
    costMicroUsd: number;
  }>
> {
  const { userId, teamId, days, limit } = params;
  const since = new Date(startOfDayUtc().getTime() - (days - 1) * 86_400_000);
  const conditions = [gte(usageEvents.at, since)];
  if (userId) conditions.push(eq(usageEvents.userId, userId));
  if (teamId) conditions.push(eq(usageEvents.teamId, teamId));

  const rows = await db
    .select({
      sessionId: usageEvents.sessionId,
      title: sessions.title,
      total: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
    })
    .from(usageEvents)
    .innerJoin(sessions, eq(sessions.id, usageEvents.sessionId))
    .where(and(...conditions))
    .groupBy(usageEvents.sessionId, sessions.title)
    .orderBy(desc(sql`sum(${usageEvents.costMicroUsd})`))
    .limit(limit);

  return rows.map((r) => ({
    sessionId: r.sessionId,
    title: r.title,
    costMicroUsd: Number(r.total),
  }));
}

export function microUsdToUsd(micro: number): number {
  return micro / 1_000_000;
}

export function usdToMicro(usd: number): number {
  return Math.round(usd * 1_000_000);
}

/** Given team ids, sum team-scoped spend across them. */
export async function getTeamsSpendWindow(
  teamIds: string[],
  window: "day" | "month",
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const since = window === "day" ? startOfDayUtc() : startOfMonthUtc();
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
    })
    .from(usageEvents)
    .where(
      and(inArray(usageEvents.teamId, teamIds), gte(usageEvents.at, since)),
    );
  return Number(rows[0]?.total ?? 0);
}
