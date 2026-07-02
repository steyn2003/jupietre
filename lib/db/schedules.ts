import "server-only";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { agentSchedules } from "./schema";

export type AgentSchedule = typeof agentSchedules.$inferSelect;
type NewAgentSchedule = typeof agentSchedules.$inferInsert;

export async function listSchedules(ownerId: string): Promise<AgentSchedule[]> {
  return db
    .select()
    .from(agentSchedules)
    .where(eq(agentSchedules.ownerId, ownerId));
}

export async function listEnabledSchedules(): Promise<AgentSchedule[]> {
  return db
    .select()
    .from(agentSchedules)
    .where(eq(agentSchedules.enabled, 1));
}

export async function getSchedule(
  ownerId: string,
  id: string,
): Promise<AgentSchedule | null> {
  const rows = await db
    .select()
    .from(agentSchedules)
    .where(and(eq(agentSchedules.ownerId, ownerId), eq(agentSchedules.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSchedule(
  input: Omit<NewAgentSchedule, "id" | "createdAt" | "updatedAt">,
): Promise<AgentSchedule> {
  const [row] = await db
    .insert(agentSchedules)
    .values({ ...input, id: nanoid() })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updateSchedule(
  ownerId: string,
  id: string,
  patch: Partial<Omit<NewAgentSchedule, "id" | "ownerId" | "createdAt">>,
): Promise<AgentSchedule | null> {
  const [row] = await db
    .update(agentSchedules)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(agentSchedules.ownerId, ownerId), eq(agentSchedules.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteSchedule(
  ownerId: string,
  id: string,
): Promise<void> {
  await db
    .delete(agentSchedules)
    .where(and(eq(agentSchedules.ownerId, ownerId), eq(agentSchedules.id, id)));
}

/** Claim today's run: sets lastRunDay=day only if it isn't already. Returns
 *  true when this caller won the claim — the guard against double-firing. */
export async function claimRunDay(id: string, day: string): Promise<boolean> {
  const rows = await db
    .update(agentSchedules)
    .set({ lastRunDay: day, updatedAt: new Date() })
    .where(
      and(
        eq(agentSchedules.id, id),
        or(
          isNull(agentSchedules.lastRunDay),
          ne(agentSchedules.lastRunDay, day),
        ),
      ),
    )
    .returning({ id: agentSchedules.id });
  return rows.length > 0;
}
