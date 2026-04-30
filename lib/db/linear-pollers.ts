import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { linearPollerRules, linearPollers } from "./schema";

export type LinearPoller = typeof linearPollers.$inferSelect;
export type LinearPollerRule = typeof linearPollerRules.$inferSelect;
type NewLinearPoller = typeof linearPollers.$inferInsert;
type NewLinearPollerRule = typeof linearPollerRules.$inferInsert;

export interface PollerWithRules {
  poller: LinearPoller;
  rules: LinearPollerRule[];
}

// ─── pollers ─────────────────────────────────────────────────────────

export async function listVisiblePollers(
  ownerId: string,
  myTeamIds: string[],
): Promise<LinearPoller[]> {
  if (myTeamIds.length === 0) {
    return db
      .select()
      .from(linearPollers)
      .where(eq(linearPollers.ownerId, ownerId));
  }
  return db
    .select()
    .from(linearPollers)
    .where(
      or(
        eq(linearPollers.ownerId, ownerId),
        inArray(linearPollers.teamId, myTeamIds),
      ),
    );
}

export async function getPollerById(
  id: string,
): Promise<LinearPoller | null> {
  const rows = await db
    .select()
    .from(linearPollers)
    .where(eq(linearPollers.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createPoller(
  input: Omit<NewLinearPoller, "id" | "createdAt" | "updatedAt">,
): Promise<LinearPoller> {
  const id = nanoid();
  const [row] = await db
    .insert(linearPollers)
    .values({ ...input, id })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updatePoller(
  id: string,
  patch: Partial<
    Omit<NewLinearPoller, "id" | "ownerId" | "createdAt">
  >,
): Promise<LinearPoller | null> {
  const [row] = await db
    .update(linearPollers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(linearPollers.id, id))
    .returning();
  return row ?? null;
}

export async function deletePoller(id: string): Promise<void> {
  await db.delete(linearPollers).where(eq(linearPollers.id, id));
}

// ─── rules ───────────────────────────────────────────────────────────

export async function listRulesForPoller(
  pollerId: string,
): Promise<LinearPollerRule[]> {
  return db
    .select()
    .from(linearPollerRules)
    .where(eq(linearPollerRules.pollerId, pollerId));
}

export async function getRuleById(
  id: string,
): Promise<LinearPollerRule | null> {
  const rows = await db
    .select()
    .from(linearPollerRules)
    .where(eq(linearPollerRules.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createRule(
  input: Omit<NewLinearPollerRule, "id" | "createdAt" | "updatedAt">,
): Promise<LinearPollerRule> {
  const id = nanoid();
  const [row] = await db
    .insert(linearPollerRules)
    .values({ ...input, id })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updateRule(
  id: string,
  patch: Partial<
    Omit<NewLinearPollerRule, "id" | "pollerId" | "createdAt">
  >,
): Promise<LinearPollerRule | null> {
  const [row] = await db
    .update(linearPollerRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(linearPollerRules.id, id))
    .returning();
  return row ?? null;
}

export async function deleteRule(id: string): Promise<void> {
  await db.delete(linearPollerRules).where(eq(linearPollerRules.id, id));
}

// ─── manager helpers ─────────────────────────────────────────────────

/**
 * One row per enabled poller, with its rules pre-joined. Used by the poller
 * manager (lib/linear/poller.ts) to start one tick loop per poller.
 */
export async function listEnabledPollersWithRules(): Promise<PollerWithRules[]> {
  const pollers = await db
    .select()
    .from(linearPollers)
    .where(eq(linearPollers.enabled, 1));
  if (pollers.length === 0) return [];

  const ids = pollers.map((p) => p.id);
  const allRules = await db
    .select()
    .from(linearPollerRules)
    .where(inArray(linearPollerRules.pollerId, ids));

  const rulesByPoller = new Map<string, LinearPollerRule[]>();
  for (const r of allRules) {
    const list = rulesByPoller.get(r.pollerId) ?? [];
    list.push(r);
    rulesByPoller.set(r.pollerId, list);
  }
  return pollers.map((p) => ({
    poller: p,
    rules: rulesByPoller.get(p.id) ?? [],
  }));
}

/**
 * Returns the API key of the first enabled poller, or null if none configured.
 * The Linear MCP tools fall back to LINEAR_API_KEY env when this returns null.
 */
export async function firstEnabledPollerApiKey(): Promise<string | null> {
  const rows = await db
    .select({ apiKey: linearPollers.apiKey })
    .from(linearPollers)
    .where(eq(linearPollers.enabled, 1))
    .limit(1);
  return rows[0]?.apiKey ?? null;
}

export async function pollersTableHasRows(): Promise<boolean> {
  const rows = await db.select({ id: linearPollers.id }).from(linearPollers).limit(1);
  return rows.length > 0;
}

/**
 * Owner check: a poller is "mine" if I own it directly. Team-scoped pollers
 * are listed for visibility but only the owner can edit (matches how
 * agent_configs handles team scope).
 */
export function canEditPoller(
  userId: string,
  poller: { ownerId: string },
): boolean {
  return poller.ownerId === userId;
}

export async function listMyOwnPollers(
  ownerId: string,
): Promise<LinearPoller[]> {
  return db
    .select()
    .from(linearPollers)
    .where(eq(linearPollers.ownerId, ownerId));
}
