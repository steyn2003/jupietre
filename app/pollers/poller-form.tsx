"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon, PlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";

export interface PollerFormInitial {
  id?: string;
  name: string;
  apiKey: string;
  teamKey: string;
  defaultLabel: string;
  pollIntervalMs: number;
  enabled: boolean;
}

export interface AgentOption {
  id: string;
  name: string;
  slug: string;
}

export type RuleMode = "pickup" | "triage";

export interface RuleRow {
  id: string;
  mode: RuleMode;
  pickupState: string;
  inProgressState: string | null;
  agentConfigId: string;
  labelOverride: string | null;
  workflowTemplate: string | null;
}

export function PollerForm({
  mode,
  initial,
  agents,
  rules: initialRules,
}: {
  mode: "create" | "edit";
  initial: PollerFormInitial;
  agents: AgentOption[];
  rules: RuleRow[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [teamKey, setTeamKey] = useState(initial.teamKey);
  const [defaultLabel, setDefaultLabel] = useState(initial.defaultLabel);
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(
    initial.pollIntervalMs,
  );
  const [enabled, setEnabled] = useState(initial.enabled);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name,
        apiKey,
        teamKey: teamKey.trim() || null,
        defaultLabel,
        pollIntervalMs,
        enabled,
      };
      const url = mode === "create" ? "/api/pollers" : `/api/pollers/${initial.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      if (mode === "create") {
        const data = (await res.json()) as { poller: { id: string } };
        // Land on the edit page so the operator can immediately add rules.
        router.push(`/pollers/${data.poller.id}/edit`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <Section title="Workspace">
          <Field label="Name" htmlFor="name" required>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ENG workspace"
            />
          </Field>
          <Field
            label="Linear API key"
            htmlFor="apiKey"
            required
            description="Personal API key from Linear → Settings → API. Stored as-is in the database; treat this poller row like a secret."
          >
            <Input
              id="apiKey"
              required
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono"
              placeholder="lin_api_…"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Team key"
              htmlFor="teamKey"
              description="Optional. Restrict to one Linear team (e.g. ENG). Blank = all teams the API key sees."
            >
              <Input
                id="teamKey"
                value={teamKey}
                onChange={(e) => setTeamKey(e.target.value.toUpperCase())}
                className="font-mono"
                placeholder="ENG"
              />
            </Field>
            <Field
              label="Default label"
              htmlFor="defaultLabel"
              description="Issues must carry this label to be picked up. Per-rule override is also available."
            >
              <Input
                id="defaultLabel"
                required
                value={defaultLabel}
                onChange={(e) => setDefaultLabel(e.target.value)}
                className="font-mono"
                placeholder="agent"
              />
            </Field>
          </div>
        </Section>

        <Section title="Cadence">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Poll interval"
              htmlFor="interval"
              description="Seconds between ticks. Minimum 15s."
            >
              <Input
                id="interval"
                type="number"
                min={15}
                max={3600}
                value={Math.round(pollIntervalMs / 1000)}
                onChange={(e) =>
                  setPollIntervalMs(Number(e.target.value) * 1000)
                }
                className="font-mono tabular-nums"
              />
            </Field>
            <div className="flex items-end">
              <CheckboxRow
                checked={enabled}
                onChange={setEnabled}
                label="Enabled — manager runs this poller"
              />
            </div>
          </div>
        </Section>

        {error ? (
          <p className="rounded-xl bg-danger-soft ring-1 ring-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/pollers")}
          >
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={submitting}>
            {mode === "create" ? "Create poller" : "Save poller"}
          </Button>
        </div>
      </form>

      {mode === "edit" && initial.id ? (
        <RulesEditor
          pollerId={initial.id}
          agents={agents}
          initial={initialRules}
          defaultLabel={defaultLabel}
        />
      ) : (
        <Card>
          <p className="text-[13px] text-fg-muted">
            Save the poller first, then status → agent rules can be added.
          </p>
        </Card>
      )}
    </div>
  );
}

function RulesEditor({
  pollerId,
  agents,
  initial,
  defaultLabel,
}: {
  pollerId: string;
  agents: AgentOption[];
  initial: RuleRow[];
  defaultLabel: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // ─── new-rule draft ────────────────────────────────────────────────
  const [draftMode, setDraftMode] = useState<RuleMode>("pickup");
  const [draftPickup, setDraftPickup] = useState("");
  const [draftInProgress, setDraftInProgress] = useState("");
  const [draftAgent, setDraftAgent] = useState(agents[0]?.id ?? "");
  const [draftLabelOverride, setDraftLabelOverride] = useState("");
  const [draftWorkflow, setDraftWorkflow] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  async function handleAdd() {
    setDraftError(null);
    if (!draftPickup || !draftAgent) {
      setDraftError("Pickup state and agent are required.");
      return;
    }
    if (draftMode === "pickup" && !draftInProgress) {
      setDraftError("In-progress state is required for pickup rules.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/pollers/${pollerId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: draftMode,
          pickupState: draftPickup,
          inProgressState:
            draftMode === "triage" ? null : draftInProgress,
          agentConfigId: draftAgent,
          // Triage has no per-rule label filter (it scans everything).
          labelOverride:
            draftMode === "triage"
              ? null
              : draftLabelOverride.trim() || null,
          workflowTemplate: draftWorkflow.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setDraftError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { rule: RuleRow };
      setRows((r) => [...r, data.rule]);
      setDraftMode("pickup");
      setDraftPickup("");
      setDraftInProgress("");
      setDraftLabelOverride("");
      setDraftWorkflow("");
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveRow(id: string, patch: Partial<RuleRow>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/pollers/${pollerId}/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { rule: RuleRow };
      setRows((r) => r.map((x) => (x.id === id ? data.rule : x)));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteRow(id: string) {
    if (!confirm("Delete this rule?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/pollers/${pollerId}/rules/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setRows((r) => r.filter((x) => x.id !== id));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <div className="space-y-4">
        <div>
          <h2 className="text-[14px] font-medium text-fg tracking-tight">
            Status → agent rules
          </h2>
          <p className="text-[12px] text-fg-muted mt-1 leading-relaxed">
            <strong className="text-fg">Pickup</strong> rules: an issue with
            label <code className="font-mono">{defaultLabel}</code> in the
            pickup state is handed to the agent, which is auto-moved to the
            in-progress state.
            <br />
            <strong className="text-fg">Triage</strong> rules: the agent sees
            every issue in the pickup state (no label filter) and decides what
            labels and state to apply. Tickets already carrying{" "}
            <code className="font-mono">{defaultLabel}</code> or{" "}
            <code className="font-mono">needs-human</code> are skipped — they
            already have a destination.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="text-[13px] text-fg-subtle italic px-1">
            No rules yet. Add one below.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((rule) => (
              <RuleEditableRow
                key={rule.id}
                rule={rule}
                agents={agents}
                busy={busyId === rule.id}
                onSave={(patch) => handleSaveRow(rule.id, patch)}
                onDelete={() => handleDeleteRow(rule.id)}
              />
            ))}
          </ul>
        )}

        <div className="rounded-xl ring-1 ring-hairline bg-surface-2/50 p-4 space-y-3">
          <h3 className="text-[13px] font-medium text-fg">Add rule</h3>
          <ModeRadio value={draftMode} onChange={setDraftMode} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={draftMode === "triage" ? "State to scan" : "Pickup state"}
              htmlFor="pickup"
              required
            >
              <Input
                id="pickup"
                value={draftPickup}
                onChange={(e) => setDraftPickup(e.target.value)}
                placeholder={draftMode === "triage" ? "Todo" : "Ready for PM"}
              />
            </Field>
            {draftMode === "pickup" ? (
              <Field label="In-progress state" htmlFor="ip" required>
                <Input
                  id="ip"
                  value={draftInProgress}
                  onChange={(e) => setDraftInProgress(e.target.value)}
                  placeholder="In Progress (PM)"
                />
              </Field>
            ) : (
              <Field
                label="In-progress state"
                htmlFor="ip"
                description="Triage agent decides — no auto-transition."
              >
                <Input
                  id="ip"
                  value=""
                  disabled
                  placeholder="(agent decides)"
                />
              </Field>
            )}
            <Field label="Agent" htmlFor="agent" required>
              <Select
                id="agent"
                value={draftAgent}
                onChange={(e) => setDraftAgent(e.target.value)}
              >
                <option value="">— pick an agent —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.slug})
                  </option>
                ))}
              </Select>
            </Field>
            {draftMode === "pickup" ? (
              <Field
                label="Label override"
                htmlFor="lo"
                description="Blank = inherit poller default."
              >
                <Input
                  id="lo"
                  value={draftLabelOverride}
                  onChange={(e) => setDraftLabelOverride(e.target.value)}
                  className="font-mono"
                  placeholder={defaultLabel}
                />
              </Field>
            ) : (
              <Field
                label="Label filter"
                htmlFor="lo"
                description="Triage scans every ticket in the state."
              >
                <Input
                  id="lo"
                  value="(none — agent sees all)"
                  disabled
                  className="font-mono"
                />
              </Field>
            )}
          </div>
          <Field
            label="Workflow text (optional)"
            htmlFor="wf"
            description={
              draftMode === "triage"
                ? "Blank = built-in triage workflow (read → size → decide one outcome)."
                : "Blank = role default keyed by the agent's slug."
            }
          >
            <Textarea
              id="wf"
              rows={5}
              value={draftWorkflow}
              onChange={(e) => setDraftWorkflow(e.target.value)}
              placeholder={
                draftMode === "triage"
                  ? "## Workflow (Triage)\n\n1. Read — linear_get_issue …"
                  : "## Workflow\n\n1. Picked up — comment with linear_add_comment …"
              }
              className="font-mono text-[12px]"
            />
          </Field>
          {draftError ? (
            <p className="text-[12px] text-danger">{draftError}</p>
          ) : null}
          <div className="flex justify-end">
            <Button
              size="sm"
              type="button"
              loading={adding}
              disabled={adding}
              onClick={handleAdd}
              trailingIcon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
            >
              Add rule
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function RuleEditableRow({
  rule,
  agents,
  busy,
  onSave,
  onDelete,
}: {
  rule: RuleRow;
  agents: AgentOption[];
  busy: boolean;
  onSave: (patch: Partial<RuleRow>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [mode, setMode] = useState<RuleMode>(rule.mode);
  const [pickupState, setPickupState] = useState(rule.pickupState);
  const [inProgressState, setInProgressState] = useState(
    rule.inProgressState ?? "",
  );
  const [agentConfigId, setAgentConfigId] = useState(rule.agentConfigId);
  const [labelOverride, setLabelOverride] = useState(rule.labelOverride ?? "");
  const [workflowTemplate, setWorkflowTemplate] = useState(
    rule.workflowTemplate ?? "",
  );

  const isTriage = mode === "triage";

  // For dirty-tracking, normalize triage's empty in-progress / label-override
  // to null so saving doesn't ping-pong between "" and null.
  const normalizedInProgress = isTriage ? null : inProgressState || null;
  const normalizedLabelOverride = isTriage ? null : labelOverride || null;
  const dirty =
    mode !== rule.mode ||
    pickupState !== rule.pickupState ||
    normalizedInProgress !== rule.inProgressState ||
    agentConfigId !== rule.agentConfigId ||
    normalizedLabelOverride !== rule.labelOverride ||
    (workflowTemplate || null) !== rule.workflowTemplate;

  return (
    <li className="rounded-xl ring-1 ring-hairline bg-surface-1 p-4 space-y-3">
      <ModeRadio value={mode} onChange={setMode} idSuffix={rule.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={isTriage ? "State to scan" : "Pickup state"}
          htmlFor={`p-${rule.id}`}
        >
          <Input
            id={`p-${rule.id}`}
            value={pickupState}
            onChange={(e) => setPickupState(e.target.value)}
          />
        </Field>
        {isTriage ? (
          <Field
            label="In-progress state"
            htmlFor={`i-${rule.id}`}
            description="Triage agent decides — no auto-transition."
          >
            <Input
              id={`i-${rule.id}`}
              value=""
              disabled
              placeholder="(agent decides)"
            />
          </Field>
        ) : (
          <Field label="In-progress state" htmlFor={`i-${rule.id}`}>
            <Input
              id={`i-${rule.id}`}
              value={inProgressState}
              onChange={(e) => setInProgressState(e.target.value)}
            />
          </Field>
        )}
        <Field label="Agent" htmlFor={`a-${rule.id}`}>
          <Select
            id={`a-${rule.id}`}
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
        {isTriage ? (
          <Field
            label="Label filter"
            htmlFor={`l-${rule.id}`}
            description="Triage scans every ticket in the state."
          >
            <Input
              id={`l-${rule.id}`}
              value="(none — agent sees all)"
              disabled
              className="font-mono"
            />
          </Field>
        ) : (
          <Field
            label="Label override"
            htmlFor={`l-${rule.id}`}
            description="Blank = inherit"
          >
            <Input
              id={`l-${rule.id}`}
              value={labelOverride}
              onChange={(e) => setLabelOverride(e.target.value)}
              className="font-mono"
            />
          </Field>
        )}
      </div>
      <Field
        label="Workflow text"
        htmlFor={`w-${rule.id}`}
        description={
          isTriage
            ? "Blank = built-in triage workflow."
            : "Blank = default for this agent's slug."
        }
      >
        <Textarea
          id={`w-${rule.id}`}
          rows={6}
          value={workflowTemplate}
          onChange={(e) => setWorkflowTemplate(e.target.value)}
          className="font-mono text-[12px]"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button
          variant="danger"
          size="sm"
          type="button"
          disabled={busy}
          loading={busy}
          onClick={onDelete}
          trailingIcon={<TrashIcon weight="bold" className="h-3.5 w-3.5" />}
        >
          Delete
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={!dirty || busy}
          loading={busy}
          onClick={() =>
            onSave({
              mode,
              pickupState,
              inProgressState: normalizedInProgress,
              agentConfigId,
              labelOverride: normalizedLabelOverride,
              workflowTemplate: workflowTemplate || null,
            })
          }
        >
          Save
        </Button>
      </div>
    </li>
  );
}

function ModeRadio({
  value,
  onChange,
  idSuffix,
}: {
  value: RuleMode;
  onChange: (v: RuleMode) => void;
  idSuffix?: string;
}) {
  const name = `rule-mode-${idSuffix ?? "draft"}`;
  return (
    <div className="flex flex-wrap gap-2">
      {(
        [
          {
            value: "pickup" as const,
            label: "Pickup",
            hint: "label + state → run agent",
          },
          {
            value: "triage" as const,
            label: "Triage",
            hint: "agent sees all, decides",
          },
        ]
      ).map((o) => {
        const active = value === o.value;
        return (
          <label
            key={o.value}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3.5 h-9 text-[13px] cursor-pointer",
              "ring-1 transition-colors duration-150",
              active
                ? "bg-accent-soft text-accent ring-[color:var(--accent-soft)]"
                : "bg-surface-2 text-fg-muted ring-hairline hover:text-fg",
            )}
          >
            <input
              type="radio"
              name={name}
              checked={active}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                active ? "bg-accent" : "bg-fg-subtle",
              )}
            />
            {o.label}
            <span className="text-[11px] text-fg-subtle">— {o.hint}</span>
          </label>
        );
      })}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="space-y-4">
        <div>
          <h2 className="text-[14px] font-medium text-fg tracking-tight">
            {title}
          </h2>
          {description ? (
            <p className="text-[12px] text-fg-muted mt-1 leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </Card>
  );
}

function CheckboxRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <span
        className={cn(
          "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]",
          "ring-1 transition-colors duration-150",
          checked
            ? "bg-accent ring-accent text-accent-fg"
            : "bg-surface-2 ring-hairline group-hover:ring-strong",
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        {checked ? (
          <svg
            viewBox="0 0 12 12"
            className="h-2.5 w-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 6.5L4.5 9 10 3.5" />
          </svg>
        ) : null}
      </span>
      <span className="text-[13px] text-fg leading-snug">{label}</span>
    </label>
  );
}
