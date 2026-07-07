"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  KanbanIcon,
  GithubLogoIcon,
  UsersThreeIcon,
  BroadcastIcon,
  LinkSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import {
  shortModel,
  type AgentDTO,
  type ConnectionDTO,
  type RecentSessionDTO,
} from "./os-graph-types";

// ────────────────────────────────────────────────────────────────────
// Right-side inspector — read-only summary + functional enable toggles
// and connection-grant management for the selected agent. Extracted
// from os-canvas.tsx; wrap in <AnimatePresence> at the call site.
// ────────────────────────────────────────────────────────────────────

const RUNNING = "rgb(59,130,246)";

const statusTone: Record<string, string> = {
  running: RUNNING,
  error: "rgb(239,68,68)",
  idle: "var(--fg-subtle)",
};

export function AgentInspector({
  agent,
  sessions,
  connections,
  grantedConnectionIds,
  onClose,
  onPatched,
}: {
  agent: AgentDTO;
  sessions: RecentSessionDTO[];
  connections: ConnectionDTO[];
  grantedConnectionIds: string[];
  onClose: () => void;
  onPatched: () => void;
}) {
  const [flags, setFlags] = useState({
    enableLinearTools: agent.enableLinearTools === 1,
    enableGithubTools: agent.enableGithubTools === 1,
    enableAgentTools: agent.enableAgentTools === 1,
    enableEventTools: agent.enableEventTools === 1,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [grantBusy, setGrantBusy] = useState<string | null>(null);
  const [addConnId, setAddConnId] = useState("");

  const grantedSet = new Set(grantedConnectionIds);
  const grantedConnections = connections.filter((c) => grantedSet.has(c.id));
  const availableConnections = connections.filter((c) => !grantedSet.has(c.id));

  async function grant(connectionId: string) {
    if (!agent.canEdit) {
      setError("You can only edit agents you own.");
      return;
    }
    setError(null);
    setGrantBusy(connectionId);
    try {
      const res = await fetch(`/api/agents/${agent.id}/grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not add connection.");
      } else {
        setAddConnId("");
        onPatched();
      }
    } catch {
      setError("Could not add connection.");
    } finally {
      setGrantBusy(null);
    }
  }

  async function revoke(connectionId: string) {
    if (!agent.canEdit) {
      setError("You can only edit agents you own.");
      return;
    }
    setError(null);
    setGrantBusy(connectionId);
    try {
      const res = await fetch(`/api/agents/${agent.id}/grants`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not remove connection.");
      } else {
        onPatched();
      }
    } catch {
      setError("Could not remove connection.");
    } finally {
      setGrantBusy(null);
    }
  }

  async function toggle(key: keyof typeof flags) {
    if (!agent.canEdit) {
      setError("You can only edit agents you own.");
      return;
    }
    const next = !flags[key];
    setFlags((f) => ({ ...f, [key]: next }));
    setError(null);
    setSaving(key);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFlags((f) => ({ ...f, [key]: !next }));
        setError(body?.error ?? "Update failed.");
      } else {
        onPatched();
      }
    } catch {
      setFlags((f) => ({ ...f, [key]: !next }));
      setError("Update failed.");
    } finally {
      setSaving(null);
    }
  }

  const budgets = [
    agent.maxBudgetUsd != null ? `$${agent.maxBudgetUsd}/session` : null,
    agent.dailyBudgetUsd != null ? `$${agent.dailyBudgetUsd}/day` : null,
    agent.monthlyBudgetUsd != null ? `$${agent.monthlyBudgetUsd}/mo` : null,
  ].filter(Boolean) as string[];

  const capChips = [
    agent.enableLinearTools === 1 ? "Linear" : null,
    agent.enableGithubTools === 1 ? "GitHub" : null,
    agent.enableAgentTools === 1 ? "Delegate" : null,
    agent.enableEventTools === 1 ? "Events" : null,
  ].filter(Boolean) as string[];

  return (
    <motion.aside
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 32, opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      className="absolute right-3 top-3 bottom-3 z-10 w-[320px] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl bg-surface-1/95 backdrop-blur-xl ring-1 ring-hairline shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">Agent</p>
          <h3 className="mt-0.5 truncate text-[16px] font-medium text-fg">{agent.name}</h3>
          <p className="mt-0.5 font-mono text-[12px] text-fg-subtle">
            {shortModel(agent.model)} · {agent.effort}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg hover:bg-surface-2"
        >
          <XIcon weight="bold" className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 px-4 pb-4">
        {capChips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {capChips.map((c) => (
              <span
                key={c}
                className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted ring-1 ring-hairline"
              >
                {c}
              </span>
            ))}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">Capabilities</p>
          <ToggleRow
            icon={<KanbanIcon weight="regular" className="h-4 w-4" />}
            label="Linear tools"
            on={flags.enableLinearTools}
            busy={saving === "enableLinearTools"}
            onToggle={() => void toggle("enableLinearTools")}
          />
          <ToggleRow
            icon={<GithubLogoIcon weight="regular" className="h-4 w-4" />}
            label="GitHub tools"
            on={flags.enableGithubTools}
            busy={saving === "enableGithubTools"}
            onToggle={() => void toggle("enableGithubTools")}
          />
          <ToggleRow
            icon={<UsersThreeIcon weight="regular" className="h-4 w-4" />}
            label="Delegate (orchestrator)"
            on={flags.enableAgentTools}
            busy={saving === "enableAgentTools"}
            onToggle={() => void toggle("enableAgentTools")}
          />
          <ToggleRow
            icon={<BroadcastIcon weight="regular" className="h-4 w-4" />}
            label="Event tools"
            on={flags.enableEventTools}
            busy={saving === "enableEventTools"}
            onToggle={() => void toggle("enableEventTools")}
          />
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">
            Connections
          </p>
          {grantedConnections.length === 0 ? (
            <p className="text-[12px] text-fg-subtle">
              No connections granted.
            </p>
          ) : (
            <ul className="space-y-1">
              {grantedConnections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg bg-surface-2/60 px-2.5 py-1.5"
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: "rgb(20,184,166)" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg">
                    {c.name}
                    <span className="ml-1 text-fg-subtle">· {c.kind}</span>
                  </span>
                  {agent.canEdit ? (
                    <button
                      aria-label={`Remove ${c.name}`}
                      disabled={grantBusy === c.id}
                      onClick={() => void revoke(c.id)}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-danger hover:bg-surface-1 disabled:opacity-50"
                    >
                      <XIcon weight="bold" className="h-3 w-3" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {agent.canEdit && availableConnections.length > 0 ? (
            <div className="flex items-center gap-2 pt-1">
              <select
                value={addConnId}
                onChange={(e) => setAddConnId(e.target.value)}
                className="h-8 flex-1 rounded-lg bg-surface-2 px-2 text-[12px] text-fg ring-1 ring-hairline"
              >
                <option value="">Add a connection…</option>
                {availableConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.kind})
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!addConnId || grantBusy === addConnId}
                onClick={() => addConnId && void grant(addConnId)}
              >
                Add
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-muted">
          <span>
            Skills:{" "}
            <span className="text-fg">
              {agent.selectedSkillsCount === "all" ? "all" : agent.selectedSkillsCount}
            </span>
          </span>
          {budgets.length > 0 ? (
            <span>
              Budget: <span className="text-fg">{budgets.join(" · ")}</span>
            </span>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">Recent sessions</p>
          {sessions.length === 0 ? (
            <p className="text-[12px] text-fg-subtle">No recent sessions.</p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/sessions/${s.id}`}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: statusTone[s.status] ?? "var(--fg-subtle)" }}
                    />
                    <span className="truncate text-[12px] text-fg">{s.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Link href={`/agents/${agent.id}/edit`} className="flex-1">
            <Button variant="secondary" size="sm" fullWidth leadingIcon={<LinkSimpleIcon weight="bold" className="h-3.5 w-3.5" />}>
              Open agent
            </Button>
          </Link>
          <Link href={`/sessions/new?agent=${agent.slug}`} className="flex-1">
            <Button size="sm" fullWidth>
              New session
            </Button>
          </Link>
        </div>
      </div>
    </motion.aside>
  );
}

function ToggleRow({
  icon,
  label,
  on,
  busy,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="inline-flex h-4 w-4 items-center justify-center text-fg-muted">{icon}</span>
      <span className="flex-1 text-[13px] text-fg">{label}</span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={busy}
        onClick={onToggle}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
        style={{ background: on ? "var(--accent)" : "var(--surface-2)" }}
      >
        <span
          className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: on ? "translateX(18px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}
