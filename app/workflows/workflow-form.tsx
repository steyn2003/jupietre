"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import {
  workflowDefinitionSchema,
  RECEIVABLE_KINDS,
  TRANSITION_KINDS,
  type ReceivableKind,
  type TransitionKind,
} from "@/lib/workflows/definitions";
import {
  type FormLimits,
  type FormNode,
  type FormTransition,
  type WorkflowFormInitial,
} from "./form-helpers";

interface AgentOption {
  id: string;
  name: string;
  slug: string;
}

// ────────────────────────────────────────────────────────────────────

export function WorkflowForm({
  initial,
  agents,
}: {
  initial: WorkflowFormInitial;
  agents: AgentOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [nodes, setNodes] = useState<FormNode[]>(initial.nodes);
  const [transitions, setTransitions] = useState<FormTransition[]>(
    initial.transitions,
  );
  const [limits, setLimits] = useState<FormLimits>(initial.limits);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const nodeSlugs = useMemo(() => nodes.map((n) => n.slug).filter(Boolean), [nodes]);

  // Build the definition shape the API wants + live-validate via zod.
  const { definition, validationError } = useMemo(() => {
    const def = {
      nodes: Object.fromEntries(
        nodes
          .filter((n) => n.slug.trim() !== "")
          .map((n) => [
            n.slug.trim(),
            {
              agentConfigId: n.agentConfigId,
              canReceive: n.canReceive,
            },
          ]),
      ),
      transitions: transitions.map((t) => {
        const base = { from: t.from, kind: t.kind };
        return t.kind === "complete" ? base : { ...base, to: t.to };
      }),
      limits: {
        ...(limits.maxRejects !== ""
          ? { maxRejects: Number(limits.maxRejects) }
          : {}),
        ...(limits.maxAsks !== "" ? { maxAsks: Number(limits.maxAsks) } : {}),
        ...(limits.maxBudgetUsd !== ""
          ? { maxBudgetUsd: Number(limits.maxBudgetUsd) }
          : {}),
      },
    };
    const parsed = workflowDefinitionSchema.safeParse(def);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        definition: def,
        validationError: first
          ? `${first.path.join(".") || "(root)"}: ${first.message}`
          : "invalid",
      };
    }
    return { definition: parsed.data, validationError: null as string | null };
  }, [nodes, transitions, limits]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (validationError) {
      setServerError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const body = { name, slug, definition };
      const res = initial.id
        ? await fetch(`/api/workflows/${initial.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, definition }),
          })
        : await fetch("/api/workflows", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        workflow?: { id: string };
      } | null;
      if (!res.ok) {
        setServerError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      router.push("/workflows");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputCls}
          />
        </Field>
        <Field
          label="Slug"
          required
          description="lowercase, letters/digits/_ or -"
        >
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            disabled={!!initial.id}
            pattern="^[a-z0-9][a-z0-9_-]*$"
            className={inputCls}
          />
        </Field>
      </div>

      {/* ── Nodes ── */}
      <section className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Nodes</div>
            <div className="text-[12px] text-fg-subtle">
              Each node is an agent's role in the flow. canReceive controls which
              message kinds that node accepts.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              setNodes((n) => [
                ...n,
                { slug: "", agentConfigId: "", canReceive: ["handoff"] },
              ])
            }
          >
            Add node
          </Button>
        </div>
        {nodes.map((n, i) => (
          <div
            key={i}
            className="grid gap-2 sm:grid-cols-[1fr_1.5fr_1fr_auto] items-start"
          >
            <input
              type="text"
              value={n.slug}
              onChange={(e) => updateNode(setNodes, i, { slug: e.target.value })}
              placeholder="node slug (e.g. eng)"
              className={inputCls}
              pattern="^[a-z0-9][a-z0-9_-]*$"
            />
            <select
              value={n.agentConfigId}
              onChange={(e) =>
                updateNode(setNodes, i, { agentConfigId: e.target.value })
              }
              className={inputCls}
            >
              <option value="">Pick an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.slug})
                </option>
              ))}
            </select>
            <CanReceiveChecklist
              value={n.canReceive}
              onChange={(next) => updateNode(setNodes, i, { canReceive: next })}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setNodes((arr) => arr.filter((_, j) => j !== i))
              }
            >
              ✕
            </Button>
          </div>
        ))}
      </section>

      {/* ── Transitions ── */}
      <section className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Transitions</div>
            <div className="text-[12px] text-fg-subtle">
              Allowed message paths. A handoff/ask/reject moves to another node;
              complete ends the run. Every transition's from/to must be a
              declared node above.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              setTransitions((t) => [
                ...t,
                {
                  from: nodeSlugs[0] ?? "",
                  kind: "handoff",
                  to: nodeSlugs[1] ?? "",
                },
              ])
            }
          >
            Add transition
          </Button>
        </div>
        {transitions.map((t, i) => (
          <div
            key={i}
            className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_1fr_auto] items-center"
          >
            <select
              value={t.from}
              onChange={(e) =>
                updateTransition(setTransitions, i, { from: e.target.value })
              }
              className={inputCls}
            >
              <option value="">from…</option>
              {nodeSlugs.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="text-fg-subtle text-sm">—</span>
            <select
              value={t.kind}
              onChange={(e) =>
                updateTransition(setTransitions, i, {
                  kind: e.target.value as TransitionKind,
                })
              }
              className={inputCls}
            >
              {TRANSITION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {t.kind === "complete" ? (
              <div className="text-[12px] text-fg-subtle self-center">
                (ends run)
              </div>
            ) : (
              <select
                value={t.to}
                onChange={(e) =>
                  updateTransition(setTransitions, i, { to: e.target.value })
                }
                className={inputCls}
              >
                <option value="">to…</option>
                {nodeSlugs.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setTransitions((arr) => arr.filter((_, j) => j !== i))
              }
            >
              ✕
            </Button>
          </div>
        ))}
      </section>

      {/* ── Limits ── */}
      <section className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 p-4 space-y-3">
        <div>
          <div className="font-medium">Limits</div>
          <div className="text-[12px] text-fg-subtle">
            Guardrails against runaway runs. Blank = no limit.
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Max rejects">
            <input
              type="number"
              min={0}
              value={limits.maxRejects}
              onChange={(e) =>
                setLimits({ ...limits, maxRejects: e.target.value })
              }
              className={inputCls}
            />
          </Field>
          <Field label="Max asks">
            <input
              type="number"
              min={0}
              value={limits.maxAsks}
              onChange={(e) =>
                setLimits({ ...limits, maxAsks: e.target.value })
              }
              className={inputCls}
            />
          </Field>
          <Field label="Max budget USD">
            <input
              type="number"
              step="0.01"
              min={0}
              value={limits.maxBudgetUsd}
              onChange={(e) =>
                setLimits({ ...limits, maxBudgetUsd: e.target.value })
              }
              className={inputCls}
            />
          </Field>
        </div>
      </section>

      {/* ── Feedback + submit ── */}
      {validationError ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-[13px]">
          <strong>Validation:</strong> {validationError}
        </div>
      ) : null}
      {serverError ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-2 text-[13px]">
          <strong>Error:</strong> {serverError}
        </div>
      ) : null}

      <details className="rounded-xl bg-surface-2/60 p-3 text-[12px]">
        <summary className="cursor-pointer select-none text-fg-muted">
          JSON preview
        </summary>
        <pre className="mt-2 overflow-auto text-[11px] leading-relaxed">
          {JSON.stringify(definition, null, 2)}
        </pre>
      </details>

      <div className="flex items-center gap-2">
        <Button type="submit" loading={submitting} disabled={!!validationError}>
          {initial.id ? "Save changes" : "Create workflow"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/workflows")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────────

function CanReceiveChecklist({
  value,
  onChange,
}: {
  value: ReceivableKind[];
  onChange: (next: ReceivableKind[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {RECEIVABLE_KINDS.map((k) => {
        const on = value.includes(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() =>
              onChange(on ? value.filter((x) => x !== k) : [...value, k])
            }
            className={
              "rounded-full px-2 py-0.5 ring-1 transition " +
              (on
                ? "bg-accent text-accent-fg ring-accent"
                : "bg-surface-2 text-fg-subtle ring-hairline hover:text-fg")
            }
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}

function updateNode(
  setNodes: React.Dispatch<React.SetStateAction<FormNode[]>>,
  i: number,
  patch: Partial<FormNode>,
) {
  setNodes((arr) => arr.map((n, j) => (j === i ? { ...n, ...patch } : n)));
}

function updateTransition(
  setTransitions: React.Dispatch<React.SetStateAction<FormTransition[]>>,
  i: number,
  patch: Partial<FormTransition>,
) {
  setTransitions((arr) =>
    arr.map((t, j) => (j === i ? { ...t, ...patch } : t)),
  );
}

const inputCls =
  "w-full rounded-lg border border-hairline bg-surface-2/40 px-3 h-9 text-[13px] focus:outline-none focus:border-strong";
