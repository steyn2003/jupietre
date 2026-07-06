"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BroadcastIcon,
  RobotIcon,
  LightningIcon,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";

interface SubscriptionRow {
  id: string;
  agentConfigId: string;
  topicPattern: string;
  repoId: string | null;
  promptTemplate: string | null;
  maxPerHour: number;
  enabled: boolean;
  lastDelivery: { status: string; createdAt: string } | null;
}
interface WebhookRow {
  id: string;
  name: string;
  key: string;
  topic: string;
  enabled: boolean;
}
interface EventRow {
  id: string;
  topic: string;
  source: "agent" | "webhook";
  sourceAgentConfigId: string | null;
  createdAt: string;
  payloadJson: unknown;
  deliveryCount: number;
}
interface AgentOption {
  id: string;
  slug: string;
  name: string;
}
interface RepoOption {
  id: string;
  slug: string;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function EventsClient({
  subscriptions,
  webhooks,
  events,
  agents,
  repos,
}: {
  subscriptions: SubscriptionRow[];
  webhooks: WebhookRow[];
  events: EventRow[];
  agents: AgentOption[];
  repos: RepoOption[];
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const agentName = (id: string | null) =>
    (id && agents.find((a) => a.id === id)?.name) || null;

  // Resolve an event's source badge: emitting agent, or a webhook that owns
  // the topic, else the bare source kind.
  const webhookByTopic = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of webhooks) if (!m.has(w.topic)) m.set(w.topic, w.name);
    return m;
  }, [webhooks]);

  return (
    <div className="space-y-10">
      <SubscriptionsSection
        rows={subscriptions}
        agents={agents}
        repos={repos}
        onChanged={() => router.refresh()}
      />
      <WebhooksSection
        rows={webhooks}
        origin={origin}
        onChanged={() => router.refresh()}
      />
      <ActivitySection
        events={events}
        resolveSource={(e) =>
          e.source === "agent"
            ? (agentName(e.sourceAgentConfigId) ?? "agent")
            : (webhookByTopic.get(e.topic) ?? "webhook")
        }
      />
    </div>
  );
}

async function apiCall(path: string, init: RequestInit): Promise<boolean> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    alert(data?.error ?? `Failed (${res.status})`);
    return false;
  }
  return true;
}

// ─── Subscriptions ───────────────────────────────────────────────────

function SubscriptionsSection({
  rows,
  agents,
  repos,
  onChanged,
}: {
  rows: SubscriptionRow[];
  agents: AgentOption[];
  repos: RepoOption[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [agentConfigId, setAgentConfigId] = useState(agents[0]?.id ?? "");
  const [topicPattern, setTopicPattern] = useState("");
  const [repoId, setRepoId] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [maxPerHour, setMaxPerHour] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentName = (id: string) =>
    agents.find((a) => a.id === id)?.name ?? "(deleted agent)";
  const repoSlug = (id: string | null) =>
    id === null ? "default" : (repos.find((r) => r.id === id)?.slug ?? "(deleted)");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/event-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentConfigId,
          topicPattern,
          repoId: repoId === "" ? null : repoId,
          promptTemplate: promptTemplate.trim() || null,
          maxPerHour,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setTopicPattern("");
      setPromptTemplate("");
      setShowForm(false);
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(row: SubscriptionRow) {
    setBusyId(row.id);
    try {
      if (
        await apiCall(`/api/event-subscriptions/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !row.enabled }),
        })
      )
        onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: SubscriptionRow) {
    if (!confirm(`Delete subscription for "${row.topicPattern}"?`)) return;
    setBusyId(row.id);
    try {
      if (
        await apiCall(`/api/event-subscriptions/${row.id}`, { method: "DELETE" })
      )
        onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-medium text-fg tracking-tight">
            Subscriptions
          </h2>
          <p className="text-[12px] text-fg-muted mt-0.5">
            Wire a topic pattern to an agent. Each matching event spawns a
            session. Use <code className="font-mono">deploy.*</code> for a prefix.
          </p>
        </div>
        {agents.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowForm((s) => !s)}
          >
            {showForm ? "Close" : "New subscription"}
          </Button>
        ) : null}
      </div>

      {rows.length === 0 && !showForm ? (
        <EmptyState
          icon={<BroadcastIcon weight="regular" className="h-5 w-5" />}
          title="No subscriptions yet"
          description="Subscribe an agent to a topic — a nightly deploy notice, a triaged ticket, anything on the bus."
          action={
            agents.length > 0 ? (
              <Button onClick={() => setShowForm(true)}>New subscription</Button>
            ) : undefined
          }
        />
      ) : rows.length > 0 ? (
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[13px] font-medium text-fg truncate">
                    {s.topicPattern}
                  </span>
                  <span className="text-fg-subtle">→</span>
                  <Badge>
                    <span className="font-mono normal-case">
                      {agentName(s.agentConfigId)}
                    </span>
                  </Badge>
                  {s.enabled ? (
                    <Badge tone="accent">enabled</Badge>
                  ) : (
                    <Badge>paused</Badge>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-fg-muted flex-wrap">
                  <span className="font-mono">{repoSlug(s.repoId)}</span>
                  <span className="text-fg-subtle">·</span>
                  <span className="tabular-nums">max {s.maxPerHour}/h</span>
                  {s.lastDelivery ? (
                    <>
                      <span className="text-fg-subtle">·</span>
                      <span>
                        last {s.lastDelivery.status} {fmt(s.lastDelivery.createdAt)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-fg-subtle">·</span>
                      <span className="italic">no deliveries yet</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyId === s.id}
                  onClick={() => toggle(s)}
                >
                  {s.enabled ? "Pause" : "Enable"}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busyId === s.id}
                  onClick={() => remove(s)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {showForm ? (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agent" htmlFor="sub-agent" required>
                <Select
                  id="sub-agent"
                  value={agentConfigId}
                  onChange={(e) => setAgentConfigId(e.target.value)}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.slug})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Topic pattern"
                htmlFor="sub-topic"
                required
                description="Exact ('deploy.finished') or prefix wildcard ('deploy.*')."
              >
                <Input
                  id="sub-topic"
                  required
                  value={topicPattern}
                  onChange={(e) => setTopicPattern(e.target.value)}
                  className="font-mono"
                  placeholder="deploy.*"
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Repo"
                htmlFor="sub-repo"
                description="“Default” uses the owner's first repo."
              >
                <Select
                  id="sub-repo"
                  value={repoId}
                  onChange={(e) => setRepoId(e.target.value)}
                >
                  <option value="">Default (first repo)</option>
                  {repos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.slug}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Max / hour"
                htmlFor="sub-rate"
                description="Delivery rate cap. Excess events are skipped."
              >
                <Input
                  id="sub-rate"
                  type="number"
                  min={1}
                  max={1000}
                  value={maxPerHour}
                  onChange={(e) => setMaxPerHour(Number(e.target.value))}
                  className="font-mono tabular-nums"
                />
              </Field>
            </div>
            <Field
              label="Prompt template"
              htmlFor="sub-prompt"
              description="Optional prefix for the kickoff message. The event topic + payload are always appended."
            >
              <Textarea
                id="sub-prompt"
                rows={3}
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                placeholder="A deploy just finished. Verify the release notes…"
              />
            </Field>
            {error ? (
              <p className="rounded-xl bg-danger-soft ring-1 ring-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={submitting} disabled={submitting}>
                Create subscription
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </section>
  );
}

// ─── Webhooks ────────────────────────────────────────────────────────

function WebhooksSection({
  rows,
  origin,
  onChanged,
}: {
  rows: WebhookRow[];
  origin: string;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const urlFor = (key: string) => `${origin}/api/hooks/${key}`;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, topic }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setName("");
      setTopic("");
      setShowForm(false);
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(row: WebhookRow) {
    try {
      await navigator.clipboard.writeText(urlFor(row.key));
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((c) => (c === row.id ? null : c)), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  async function regenerate(row: WebhookRow) {
    if (!confirm(`Rotate the key for "${row.name}"? The old URL stops working.`))
      return;
    setBusyId(row.id);
    try {
      if (
        await apiCall(`/api/webhooks/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ regenerateKey: true }),
        })
      )
        onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(row: WebhookRow) {
    setBusyId(row.id);
    try {
      if (
        await apiCall(`/api/webhooks/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !row.enabled }),
        })
      )
        onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: WebhookRow) {
    if (!confirm(`Delete webhook "${row.name}"?`)) return;
    setBusyId(row.id);
    try {
      if (await apiCall(`/api/webhooks/${row.id}`, { method: "DELETE" }))
        onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-medium text-fg tracking-tight">
            Webhooks
          </h2>
          <p className="text-[12px] text-fg-muted mt-0.5">
            An inbound URL that turns external POSTs into events under a topic.
            No auth beyond the URL secret.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowForm((s) => !s)}
        >
          {showForm ? "Close" : "New webhook"}
        </Button>
      </div>

      {rows.length === 0 && !showForm ? (
        <EmptyState
          icon={<LightningIcon weight="regular" className="h-5 w-5" />}
          title="No webhooks yet"
          description="Create one to let CI, a cron, or any external system push events onto the bus."
          action={<Button onClick={() => setShowForm(true)}>New webhook</Button>}
        />
      ) : rows.length > 0 ? (
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {rows.map((w) => (
            <li key={w.id} className="px-5 py-4 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-medium text-fg truncate">
                      {w.name}
                    </span>
                    <span className="text-fg-subtle">→</span>
                    <Badge>
                      <span className="font-mono normal-case">{w.topic}</span>
                    </Badge>
                    {w.enabled ? (
                      <Badge tone="accent">enabled</Badge>
                    ) : (
                      <Badge>paused</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyId === w.id}
                    onClick={() => regenerate(w)}
                  >
                    Rotate key
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyId === w.id}
                    onClick={() => toggle(w)}
                  >
                    {w.enabled ? "Pause" : "Enable"}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busyId === w.id}
                    onClick={() => remove(w)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2/60 px-2.5 py-1.5 font-mono text-[12px] text-fg-muted">
                  {origin ? urlFor(w.key) : `/api/hooks/${w.key}`}
                </code>
                <button
                  type="button"
                  aria-label="Copy URL"
                  onClick={() => copy(w)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 ring-1 ring-hairline"
                >
                  {copiedId === w.id ? (
                    <CheckIcon weight="bold" className="h-4 w-4" />
                  ) : (
                    <CopyIcon weight="regular" className="h-4 w-4" />
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {showForm ? (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="wh-name" required>
                <Input
                  id="wh-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="CI deploy hook"
                />
              </Field>
              <Field
                label="Topic"
                htmlFor="wh-topic"
                required
                description="Events from this hook are emitted under this topic."
              >
                <Input
                  id="wh-topic"
                  required
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="font-mono"
                  placeholder="deploy.finished"
                />
              </Field>
            </div>
            {error ? (
              <p className="rounded-xl bg-danger-soft ring-1 ring-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={submitting} disabled={submitting}>
                Create webhook
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </section>
  );
}

// ─── Activity ────────────────────────────────────────────────────────

function ActivitySection({
  events,
  resolveSource,
}: {
  events: EventRow[];
  resolveSource: (e: EventRow) => string;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-[15px] font-medium text-fg tracking-tight">
          Activity
        </h2>
        <p className="text-[12px] text-fg-muted mt-0.5">
          The 50 most recent events on the bus.
        </p>
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={<BroadcastIcon weight="regular" className="h-5 w-5" />}
          title="No events yet"
          description="Events show up here once an agent emits one or a webhook receives a POST."
        />
      ) : (
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {events.map((e) => (
            <li key={e.id} className="px-5 py-3">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                  <span
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted"
                    aria-hidden
                  >
                    {e.source === "agent" ? (
                      <RobotIcon weight="regular" className="h-4 w-4" />
                    ) : (
                      <LightningIcon weight="regular" className="h-4 w-4" />
                    )}
                  </span>
                  <span className="font-mono text-[13px] font-medium text-fg truncate">
                    {e.topic}
                  </span>
                  <Badge>{resolveSource(e)}</Badge>
                  {e.deliveryCount > 0 ? (
                    <Badge tone="accent">
                      {e.deliveryCount} deliver
                      {e.deliveryCount === 1 ? "y" : "ies"}
                    </Badge>
                  ) : null}
                  <span className="ml-auto shrink-0 text-[12px] text-fg-subtle tabular-nums">
                    {fmt(e.createdAt)}
                  </span>
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2/60 p-3 font-mono text-[12px] text-fg-muted">
                  {JSON.stringify(e.payloadJson, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
