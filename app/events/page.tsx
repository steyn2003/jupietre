import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import {
  listRecentVisibleEvents,
  listVisibleSubscriptions,
  listVisibleWebhooks,
  recentForSubscriptions,
} from "@/lib/db/events";
import { listVisibleAgentConfigs } from "@/lib/db/agent-configs";
import { visibleReposWhere } from "@/lib/auth/authz";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { AppShell } from "@/components/layout/AppShell";
import { EventsClient } from "./events-client";

export default async function EventsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const myTeamIds = await getMyTeamIds(session.userId);
  const [subscriptions, webhooks, events, agents, repoRows] = await Promise.all([
    listVisibleSubscriptions(session.userId, myTeamIds),
    listVisibleWebhooks(session.userId, myTeamIds),
    listRecentVisibleEvents(session.userId, myTeamIds, 50),
    listVisibleAgentConfigs(session.userId, myTeamIds),
    db.select().from(repos).where(visibleReposWhere(session.userId, myTeamIds)),
  ]);

  // Latest delivery per subscription for the stat line.
  const deliveries = await recentForSubscriptions(
    subscriptions.map((s) => s.id),
  );
  const lastDelivery = new Map<
    string,
    { status: string; createdAt: string }
  >();
  for (const d of deliveries) {
    if (!lastDelivery.has(d.subscriptionId)) {
      lastDelivery.set(d.subscriptionId, {
        status: d.status,
        createdAt: d.createdAt.toISOString(),
      });
    }
  }
  // Delivery count per event (from deliveries to visible subscriptions).
  const deliveryCount = new Map<string, number>();
  for (const d of deliveries) {
    deliveryCount.set(d.eventId, (deliveryCount.get(d.eventId) ?? 0) + 1);
  }

  return (
    <AppShell
      email={session.email}
      eyebrow="Automation"
      title="Events"
      description="A general event bus. Agents emit events, external systems post them via webhook URLs, and subscriptions spawn an agent session for each matching event."
    >
      <EventsClient
        subscriptions={subscriptions.map((s) => ({
          id: s.id,
          agentConfigId: s.agentConfigId,
          topicPattern: s.topicPattern,
          repoId: s.repoId,
          promptTemplate: s.promptTemplate,
          maxPerHour: s.maxPerHour,
          enabled: s.enabled === 1,
          lastDelivery: lastDelivery.get(s.id) ?? null,
        }))}
        webhooks={webhooks.map((w) => ({
          id: w.id,
          name: w.name,
          key: w.key,
          topic: w.topic,
          enabled: w.enabled === 1,
        }))}
        events={events.map((e) => ({
          id: e.id,
          topic: e.topic,
          source: e.source,
          sourceAgentConfigId: e.sourceAgentConfigId,
          createdAt: e.createdAt.toISOString(),
          payloadJson: e.payloadJson,
          deliveryCount: deliveryCount.get(e.id) ?? 0,
        }))}
        agents={agents.map((a) => ({ id: a.id, slug: a.slug, name: a.name }))}
        repos={repoRows.map((r) => ({ id: r.id, slug: r.slug }))}
      />
    </AppShell>
  );
}
