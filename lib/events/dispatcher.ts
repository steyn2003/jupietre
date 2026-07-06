import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { spawnAgentSession, type SpawnRepo } from "@/lib/agent/spawn";
import { getAgentConfigById } from "@/lib/db/agent-configs";
import {
  countForSubscriptionSince,
  createDelivery,
  listEnabledSubscriptions,
  listPendingEvents,
  markEventDispatched,
  topicMatches,
  updateDelivery,
  type EventRow,
  type EventSubscription,
} from "@/lib/db/events";

// ────────────────────────────────────────────────────────────────────
// Event dispatcher. Same in-process setInterval pattern as the schedule
// runner / workflow dispatcher. Every tick it drains pending events
// (dispatchedAt = null) from the last 24h, oldest-first, and for each
// enabled subscription whose owner can see the event's scope AND whose
// topicPattern matches, records a delivery (unique index = idempotency)
// and spawns a session. A per-delivery failure never kills the tick.
// ────────────────────────────────────────────────────────────────────

const TICK_MS = Number(process.env.EVENT_DISPATCH_INTERVAL_MS ?? 15_000);
const INITIAL_DELAY_MS = 10_000;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 10;
const MAX_CHAIN_DEPTH = Number(process.env.EVENT_MAX_CHAIN_DEPTH ?? 5);

let started = false;

export function startEventDispatcher(): void {
  if (started) return;
  if (process.env.DISABLE_EVENT_DISPATCHER === "1") {
    console.log("[events] dispatcher disabled via DISABLE_EVENT_DISPATCHER=1");
    return;
  }
  started = true;
  console.log(`[events] dispatcher starting — tick every ${TICK_MS / 1000}s`);

  const tick = () => {
    dispatchOnce().catch((err) =>
      console.error("[events] dispatch tick error:", err),
    );
  };
  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, TICK_MS);
}

/** Scope match — reuse authz semantics: same owner OR a shared team. The
 *  subscription owner must be able to see the event's scope. */
function subscriberCanSee(event: EventRow, sub: EventSubscription): boolean {
  if (event.ownerId === sub.ownerId) return true;
  if (event.teamId && sub.teamId && event.teamId === sub.teamId) return true;
  return false;
}

/** Drain up to BATCH_SIZE pending events. Exported for tests / manual kicks. */
export async function dispatchOnce(): Promise<void> {
  const pending = await listPendingEvents(LOOKBACK_MS, BATCH_SIZE);
  if (pending.length === 0) return;
  const subscriptions = await listEnabledSubscriptions();

  for (const event of pending) {
    try {
      await dispatchEvent(event, subscriptions);
    } catch (err) {
      // Never let one event poison the batch — it stays pending (dispatchedAt
      // null) unless dispatchEvent marked it, and retries next tick.
      console.error(`[events] failed to dispatch event ${event.id}:`, err);
    }
  }
}

async function dispatchEvent(
  event: EventRow,
  subscriptions: EventSubscription[],
): Promise<void> {
  const matches = subscriptions.filter(
    (s) => subscriberCanSee(event, s) && topicMatches(s.topicPattern, event.topic),
  );

  for (const sub of matches) {
    // Depth guard first — a delivery row still records the decision.
    if (event.chainDepth >= MAX_CHAIN_DEPTH) {
      await createDelivery({
        eventId: event.id,
        subscriptionId: sub.id,
        status: "skipped_depth",
      });
      continue;
    }

    // Rate cap — count this subscription's deliveries in the last rolling hour.
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await countForSubscriptionSince(sub.id, since);
    if (recent >= sub.maxPerHour) {
      await createDelivery({
        eventId: event.id,
        subscriptionId: sub.id,
        status: "skipped_rate_limit",
      });
      continue;
    }

    // Claim the (event, subscription) pair BEFORE spawning — the unique index
    // makes this idempotent, so a crash mid-spawn can't double-fire. A null
    // return means another tick already processed this pair.
    const delivery = await createDelivery({
      eventId: event.id,
      subscriptionId: sub.id,
      status: "spawned",
    });
    if (!delivery) continue;

    try {
      const sessionId = await spawnForSubscription(event, sub);
      await updateDelivery(delivery.id, { sessionId });
      console.log(
        `[events] event ${event.id} (${event.topic}) → session ${sessionId} via sub ${sub.id}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateDelivery(delivery.id, { status: "error", error: message });
      console.error(
        `[events] spawn failed for event ${event.id} sub ${sub.id}:`,
        err,
      );
    }
  }

  // Processed every match (or none) — take the event off the pending queue.
  await markEventDispatched(event.id);
}

async function spawnForSubscription(
  event: EventRow,
  sub: EventSubscription,
): Promise<string> {
  const agent = await getAgentConfigById(sub.agentConfigId);
  if (!agent) throw new Error(`subscription references a deleted agent`);

  // Repo resolution mirrors the schedule runner: a pinned repoId → that repo;
  // null → the owner's first registered repo.
  let repo: SpawnRepo | null = null;
  if (sub.repoId) {
    const r = (
      await db.select().from(repos).where(eq(repos.id, sub.repoId)).limit(1)
    )[0];
    if (r) repo = r;
  } else {
    const r = (
      await db.select().from(repos).where(eq(repos.userId, sub.ownerId)).limit(1)
    )[0];
    if (r) repo = r;
  }
  if (!repo) throw new Error("no target repo (owner has no registered repos)");

  const payloadStr = JSON.stringify(event.payloadJson ?? {}, null, 2);
  const base = `Event: ${event.topic}\nPayload:\n\`\`\`json\n${payloadStr}\n\`\`\``;
  const kickoff =
    (sub.promptTemplate ? `${sub.promptTemplate}\n\n` : "") +
    base +
    `\n\n_You were spawned by an event subscription matching \`${sub.topicPattern}\`. Do your standing job for this event, then stop._`;

  return spawnAgentSession({
    userId: sub.ownerId,
    teamId: sub.teamId,
    agentConfigId: agent.id,
    title: `${event.topic} → ${agent.name}`.slice(0, 120),
    source: "event",
    repo,
    kickoff,
    extra: { triggerEventId: event.id },
  });
}
