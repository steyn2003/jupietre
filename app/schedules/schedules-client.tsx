"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClockIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";

interface ScheduleRow {
  id: string;
  name: string;
  agentConfigId: string;
  repoId: string | null;
  prompt: string;
  hour: number;
  /** JS getDay() values (0=Sun … 6=Sat). null = every day. */
  days: number[] | null;
  enabled: boolean;
  lastRunDay: string | null;
}

// Monday-first display order; values are JS getDay().
const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function daysLabel(days: number[] | null): string {
  if (days === null || days.length === 7) return "daily";
  return WEEKDAYS.filter((d) => days.includes(d.value))
    .map((d) => d.label)
    .join(" ");
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

export function SchedulesClient({
  initial,
  agents,
  repos,
}: {
  initial: ScheduleRow[];
  agents: AgentOption[];
  repos: RepoOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(initial.length === 0);

  // create form state
  const [name, setName] = useState("");
  const [agentConfigId, setAgentConfigId] = useState(agents[0]?.id ?? "");
  const [repoId, setRepoId] = useState<string>("");
  const [hour, setHour] = useState(3);
  // Empty selection = every day (stored as null).
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentName = (id: string) =>
    agents.find((a) => a.id === id)?.name ?? "(deleted agent)";
  const repoSlug = (id: string | null) =>
    id === null ? "all repos" : (repos.find((r) => r.id === id)?.slug ?? "(deleted repo)");

  async function api(path: string, init: RequestInit): Promise<boolean> {
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          agentConfigId,
          repoId: repoId === "" ? null : repoId,
          prompt,
          hour,
          days:
            selectedDays.length === 0 || selectedDays.length === 7
              ? null
              : selectedDays,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        schedule?: Omit<ScheduleRow, "enabled"> & { enabled: number };
        error?: string;
      } | null;
      const created = data?.schedule;
      if (!res.ok || !created) {
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setRows((r) => [...r, { ...created, enabled: created.enabled === 1 }]);
      setName("");
      setPrompt("");
      setSelectedDays([]);
      setShowForm(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(row: ScheduleRow) {
    setBusyId(row.id);
    try {
      if (
        await api(`/api/schedules/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !row.enabled }),
        })
      ) {
        setRows((r) =>
          r.map((x) => (x.id === row.id ? { ...x, enabled: !x.enabled } : x)),
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleRunNow(row: ScheduleRow) {
    setBusyId(row.id);
    try {
      if (await api(`/api/schedules/${row.id}/run`, { method: "POST" })) {
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(row: ScheduleRow) {
    if (!confirm(`Delete schedule "${row.name}"?`)) return;
    setBusyId(row.id);
    try {
      if (await api(`/api/schedules/${row.id}`, { method: "DELETE" })) {
        setRows((r) => r.filter((x) => x.id !== row.id));
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {rows.length === 0 && !showForm ? (
        <EmptyState
          icon={<ClockIcon weight="regular" className="h-5 w-5" />}
          title="No schedules yet"
          description="Create one to run an agent daily — a nightly code scout, a morning ticket triage, a weekly-feel dependency check."
          action={<Button onClick={() => setShowForm(true)}>New schedule</Button>}
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
                  <span className="text-[14px] font-medium text-fg truncate">
                    {s.name}
                  </span>
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
                <div className="mt-1 flex items-center gap-2 text-[12px] text-fg-muted">
                  <span className="font-mono tabular-nums">
                    {daysLabel(s.days)} after {String(s.hour).padStart(2, "0")}:00
                  </span>
                  <span className="text-fg-subtle">·</span>
                  <span className="font-mono">{repoSlug(s.repoId)}</span>
                  {s.lastRunDay ? (
                    <>
                      <span className="text-fg-subtle">·</span>
                      <span>last ran {s.lastRunDay}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyId === s.id}
                  onClick={() => handleRunNow(s)}
                >
                  Run now
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyId === s.id}
                  onClick={() => handleToggle(s)}
                >
                  {s.enabled ? "Pause" : "Enable"}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busyId === s.id}
                  onClick={() => handleDelete(s)}
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
            <h2 className="text-[14px] font-medium text-fg tracking-tight">
              New schedule
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="sched-name" required>
                <Input
                  id="sched-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nightly scout"
                />
              </Field>
              <Field label="Agent" htmlFor="sched-agent" required>
                <Select
                  id="sched-agent"
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
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Repo"
                htmlFor="sched-repo"
                description="“All repos” starts one session per registered repo."
              >
                <Select
                  id="sched-repo"
                  value={repoId}
                  onChange={(e) => setRepoId(e.target.value)}
                >
                  <option value="">All repos</option>
                  {repos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.slug}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Hour"
                htmlFor="sched-hour"
                description="Server-local. Fires once per day after this hour."
              >
                <Input
                  id="sched-hour"
                  type="number"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={(e) => setHour(Number(e.target.value))}
                  className="font-mono tabular-nums"
                />
              </Field>
            </div>
            <Field
              label="Days"
              htmlFor="sched-days"
              description="None selected = every day."
            >
              <div id="sched-days" className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => {
                  const active = selectedDays.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() =>
                        setSelectedDays((s) =>
                          s.includes(d.value)
                            ? s.filter((x) => x !== d.value)
                            : [...s, d.value],
                        )
                      }
                      className={
                        "inline-flex items-center justify-center h-9 px-3 rounded-xl text-[12px] font-mono ring-1 transition-colors duration-150 " +
                        (active
                          ? "bg-accent-soft text-accent ring-[color:var(--accent-soft)]"
                          : "bg-surface-2 text-fg-muted ring-hairline hover:text-fg")
                      }
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Prompt" htmlFor="sched-prompt" required>
              <Textarea
                id="sched-prompt"
                required
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Do a broad sweep for your best small improvements…"
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
                Create schedule
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setShowForm(true)}>
            New schedule
          </Button>
        </div>
      )}
    </div>
  );
}
