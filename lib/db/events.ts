import "server-only";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  or,
  count,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  events,
  eventSubscriptions,
  eventDeliveries,
  webhooks,
} from "./schema";

export type EventRow = typeof events.$inferSelect;
type NewEvent = typeof events.$inferInsert;
export type EventSubscription = typeof eventSubscriptions.$inferSelect;
type NewEventSubscription = typeof eventSubscriptions.$inferInsert;
export type EventDelivery = typeof eventDeliveries.$inferSelect;
type NewEventDelivery = typeof eventDeliveries.$inferInsert;
export type Webhook = typeof webhooks.$inferSelect;
type NewWebhook = typeof webhooks.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// Topic matching. A subscription's topicPattern is either an exact topic
// or a single trailing ".*" prefix wildcard ("deploy.*"). Deliberately
// dead simple — no regex, no multi-segment globs.
// ────────────────────────────────────────────────────────────────────

export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1); // keep the trailing dot → "deploy."
    return topic.startsWith(prefix);
  }
  return pattern === topic;
}

/** lowercase dot-separated segments, no wildcards. e.g. "deploy.finished". */
export function isValidTopic(topic: string): boolean {
  return /^[a-z0-9]+(\.[a-z0-9]+)*$/.test(topic);
}

// ─── events ──────────────────────────────────────────────────────────

export async function createEvent(
  input: Omit<NewEvent, "id" | "createdAt">,
): Promise<EventRow> {
  const [row] = await db
    .insert(events)
    .values({ ...input, id: nanoid() })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function getEventById(id: string): Promise<EventRow | null> {
  const rows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Recent events visible to the user (own + team), newest first. */
export async function listRecentVisibleEvents(
  ownerId: string,
  myTeamIds: string[],
  limit = 50,
): Promise<EventRow[]> {
  const where =
    myTeamIds.length === 0
      ? eq(events.ownerId, ownerId)
      : or(eq(events.ownerId, ownerId), inArray(events.teamId, myTeamIds));
  return db
    .select()
    .from(events)
    .where(where)
    .orderBy(desc(events.createdAt))
    .limit(limit);
}

/** Pending events (dispatchedAt null) from the last `sinceMs`, oldest first.
 *  The dispatcher's work queue. */
export async function listPendingEvents(
  sinceMs: number,
  limit: number,
): Promise<EventRow[]> {
  const since = new Date(Date.now() - sinceMs);
  return db
    .select()
    .from(events)
    .where(and(isNull(events.dispatchedAt), gte(events.createdAt, since)))
    .orderBy(events.createdAt)
    .limit(limit);
}

export async function markEventDispatched(id: string): Promise<void> {
  await db
    .update(events)
    .set({ dispatchedAt: new Date() })
    .where(eq(events.id, id));
}

// ─── subscriptions ───────────────────────────────────────────────────

export async function listVisibleSubscriptions(
  ownerId: string,
  myTeamIds: string[],
): Promise<EventSubscription[]> {
  const where =
    myTeamIds.length === 0
      ? eq(eventSubscriptions.ownerId, ownerId)
      : or(
          eq(eventSubscriptions.ownerId, ownerId),
          inArray(eventSubscriptions.teamId, myTeamIds),
        );
  return db.select().from(eventSubscriptions).where(where);
}

/** Every enabled subscription across all owners — the dispatcher matches
 *  events against all of them (like the poller manager). */
export async function listEnabledSubscriptions(): Promise<EventSubscription[]> {
  return db
    .select()
    .from(eventSubscriptions)
    .where(eq(eventSubscriptions.enabled, 1));
}

export async function getSubscriptionById(
  id: string,
): Promise<EventSubscription | null> {
  const rows = await db
    .select()
    .from(eventSubscriptions)
    .where(eq(eventSubscriptions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSubscription(
  input: Omit<NewEventSubscription, "id" | "createdAt" | "updatedAt">,
): Promise<EventSubscription> {
  const [row] = await db
    .insert(eventSubscriptions)
    .values({ ...input, id: nanoid() })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updateSubscription(
  id: string,
  patch: Partial<
    Omit<NewEventSubscription, "id" | "ownerId" | "createdAt">
  >,
): Promise<EventSubscription | null> {
  const [row] = await db
    .update(eventSubscriptions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(eventSubscriptions.id, id))
    .returning();
  return row ?? null;
}

export async function deleteSubscription(id: string): Promise<void> {
  await db.delete(eventSubscriptions).where(eq(eventSubscriptions.id, id));
}

// ─── deliveries ──────────────────────────────────────────────────────

/** Insert a delivery. The unique (eventId, subscriptionId) index makes this
 *  idempotent — a duplicate returns null (nothing inserted) so the dispatcher
 *  can skip an already-processed pair. */
export async function createDelivery(
  input: Omit<NewEventDelivery, "id" | "createdAt">,
): Promise<EventDelivery | null> {
  const [row] = await db
    .insert(eventDeliveries)
    .values({ ...input, id: nanoid() })
    .onConflictDoNothing({
      target: [eventDeliveries.eventId, eventDeliveries.subscriptionId],
    })
    .returning();
  return row ?? null;
}

/** Patch a delivery after the spawn attempt resolves (sessionId + status). */
export async function updateDelivery(
  id: string,
  patch: Partial<Pick<NewEventDelivery, "sessionId" | "status" | "error">>,
): Promise<void> {
  await db.update(eventDeliveries).set(patch).where(eq(eventDeliveries.id, id));
}

/** Recent deliveries for a set of subscriptions (newest first) — drives the
 *  per-subscription stats in the UI and the canvas animation join. */
export async function recentForSubscriptions(
  subscriptionIds: string[],
  limit = 200,
): Promise<EventDelivery[]> {
  if (subscriptionIds.length === 0) return [];
  return db
    .select()
    .from(eventDeliveries)
    .where(inArray(eventDeliveries.subscriptionId, subscriptionIds))
    .orderBy(desc(eventDeliveries.createdAt))
    .limit(limit);
}

/** Count deliveries for a subscription since `since` — the rate cap. */
export async function countForSubscriptionSince(
  subscriptionId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(eventDeliveries)
    .where(
      and(
        eq(eventDeliveries.subscriptionId, subscriptionId),
        gte(eventDeliveries.createdAt, since),
      ),
    );
  return row?.value ?? 0;
}

// ─── webhooks ────────────────────────────────────────────────────────

export async function listVisibleWebhooks(
  ownerId: string,
  myTeamIds: string[],
): Promise<Webhook[]> {
  const where =
    myTeamIds.length === 0
      ? eq(webhooks.ownerId, ownerId)
      : or(eq(webhooks.ownerId, ownerId), inArray(webhooks.teamId, myTeamIds));
  return db.select().from(webhooks).where(where);
}

export async function getWebhookById(id: string): Promise<Webhook | null> {
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Lookup by URL path secret — the webhook ingest route's entry point. */
export async function getWebhookByKey(key: string): Promise<Webhook | null> {
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.key, key))
    .limit(1);
  return rows[0] ?? null;
}

export async function createWebhook(
  input: Omit<NewWebhook, "id" | "createdAt" | "key"> & { key?: string },
): Promise<Webhook> {
  const [row] = await db
    .insert(webhooks)
    .values({ ...input, id: nanoid(), key: input.key ?? nanoid(24) })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updateWebhook(
  id: string,
  patch: Partial<Omit<NewWebhook, "id" | "ownerId" | "createdAt">>,
): Promise<Webhook | null> {
  const [row] = await db
    .update(webhooks)
    .set(patch)
    .where(eq(webhooks.id, id))
    .returning();
  return row ?? null;
}

export async function deleteWebhook(id: string): Promise<void> {
  await db.delete(webhooks).where(eq(webhooks.id, id));
}
