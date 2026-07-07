"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";

const BUILTIN_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Task",
  "TodoWrite",
];

export interface AgentFormInitial {
  id?: string;
  slug: string;
  name: string;
  systemPrompt: string;
  model: string;
  fallbackModel: string | null;
  allowedTools: string[] | null;
  disallowedTools: string[];
  includeProjectSkills: boolean;
  /** null = use every visible skill; [] = none; [ids] = explicit allowlist. */
  selectedSkills: string[] | null;
  maxTurns: number;
  effort: "low" | "medium" | "high" | "max";
  maxBudgetUsd: number | null;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  enableLinearTools: boolean;
  enableGithubTools: boolean;
  enableAgentTools: boolean;
  enableEventTools: boolean;
  approvalMode: "none" | "list" | "all";
  approvalTools: string[];
  approvalTimeoutSeconds: number;
}

export interface SkillOption {
  id: string;
  slug: string;
  name: string;
}

export function AgentForm({
  mode,
  initial,
  availableSkills,
}: {
  mode: "create" | "edit";
  initial: AgentFormInitial;
  availableSkills: SkillOption[];
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(initial.slug);
  const [name, setName] = useState(initial.name);
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [model, setModel] = useState(initial.model);
  const [fallbackModel, setFallbackModel] = useState(initial.fallbackModel ?? "");
  const [toolMode, setToolMode] = useState<"all" | "only">(
    initial.allowedTools === null ? "all" : "only",
  );
  const [selectedTools, setSelectedTools] = useState<string[]>(
    initial.allowedTools ?? BUILTIN_TOOLS,
  );
  const [includeProjectSkills, setIncludeProjectSkills] = useState(
    initial.includeProjectSkills,
  );
  const [maxTurns, setMaxTurns] = useState<number>(initial.maxTurns);
  const [effort, setEffort] = useState(initial.effort);
  const [maxBudgetUsd, setMaxBudgetUsd] = useState<string>(
    initial.maxBudgetUsd === null ? "" : String(initial.maxBudgetUsd),
  );
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState<string>(
    initial.dailyBudgetUsd === null ? "" : String(initial.dailyBudgetUsd),
  );
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState<string>(
    initial.monthlyBudgetUsd === null ? "" : String(initial.monthlyBudgetUsd),
  );
  // Skill scope tri-state. "all" = null in DB, "none" = [] in DB,
  // "selected" = chip array in DB.
  const initialSkillMode: "all" | "none" | "selected" =
    initial.selectedSkills === null
      ? "all"
      : initial.selectedSkills.length === 0
        ? "none"
        : "selected";
  const [skillMode, setSkillMode] = useState<"all" | "none" | "selected">(
    initialSkillMode,
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    initial.selectedSkills ?? [],
  );
  const [enableLinearTools, setEnableLinearTools] = useState(
    initial.enableLinearTools,
  );
  const [enableGithubTools, setEnableGithubTools] = useState(
    initial.enableGithubTools,
  );
  const [enableAgentTools, setEnableAgentTools] = useState(
    initial.enableAgentTools,
  );
  const [enableEventTools, setEnableEventTools] = useState(
    initial.enableEventTools,
  );
  const [approvalMode, setApprovalMode] = useState<"none" | "list" | "all">(
    initial.approvalMode,
  );
  const [approvalTools, setApprovalTools] = useState<string[]>(
    initial.approvalTools.length > 0
      ? initial.approvalTools
      : ["Bash", "Write", "Edit"],
  );
  const [approvalTimeoutSeconds, setApprovalTimeoutSeconds] = useState<number>(
    initial.approvalTimeoutSeconds,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTool(tool: string) {
    setSelectedTools((s) =>
      s.includes(tool) ? s.filter((t) => t !== tool) : [...s, tool],
    );
  }

  function toggleSkill(id: string) {
    setSelectedSkillIds((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  }

  function toggleApprovalTool(tool: string) {
    setApprovalTools((s) =>
      s.includes(tool) ? s.filter((t) => t !== tool) : [...s, tool],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        systemPrompt,
        model,
        fallbackModel: fallbackModel.trim() || null,
        allowedTools: toolMode === "all" ? null : selectedTools,
        includeProjectSkills,
        selectedSkills:
          skillMode === "all"
            ? null
            : skillMode === "none"
              ? []
              : selectedSkillIds,
        maxTurns,
        effort,
        maxBudgetUsd: maxBudgetUsd.trim() === "" ? null : Number(maxBudgetUsd),
        dailyBudgetUsd:
          dailyBudgetUsd.trim() === "" ? null : Number(dailyBudgetUsd),
        monthlyBudgetUsd:
          monthlyBudgetUsd.trim() === "" ? null : Number(monthlyBudgetUsd),
        enableLinearTools,
        enableGithubTools,
        enableAgentTools,
        enableEventTools,
        approvalMode,
        approvalTools: approvalMode === "list" ? approvalTools : [],
        approvalTimeoutSeconds,
      };
      if (mode === "create") payload.slug = slug;

      const url = mode === "create" ? "/api/agents" : `/api/agents/${initial.id}`;
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
      router.push("/agents");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Section title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Engineer"
            />
          </Field>
          <Field
            label="Slug"
            htmlFor="slug"
            required
            description="kebab-case, unique per user. Used as the fallback key for the role-specific Linear workflow text when a poller rule has none."
          >
            <Input
              id="slug"
              required
              disabled={mode === "edit"}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              pattern="[a-z0-9-]+"
              className="font-mono"
              placeholder="engineer"
            />
          </Field>
        </div>
      </Section>

      <Section title="Behavior">
        <Field label="System prompt" htmlFor="sys" required>
          <Textarea
            id="sys"
            required
            rows={7}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a senior engineer who…"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model" htmlFor="model" required>
            <Input
              id="model"
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field
            label="Fallback model"
            htmlFor="fallback"
            description="Used if the primary model is unavailable."
          >
            <Input
              id="fallback"
              value={fallbackModel}
              onChange={(e) => setFallbackModel(e.target.value)}
              className="font-mono"
              placeholder="optional"
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Effort" htmlFor="effort">
            <Select
              id="effort"
              value={effort}
              onChange={(e) =>
                setEffort(e.target.value as "low" | "medium" | "high" | "max")
              }
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="max">max</option>
            </Select>
          </Field>
          <Field label="Max turns" htmlFor="turns">
            <Input
              id="turns"
              type="number"
              min={1}
              max={1000}
              value={maxTurns}
              onChange={(e) => setMaxTurns(Number(e.target.value))}
              className="font-mono tabular-nums"
            />
          </Field>
          <Field
            label="Max / session"
            htmlFor="budget"
            description="USD. Blank = no cap."
          >
            <Input
              id="budget"
              type="number"
              min={1}
              value={maxBudgetUsd}
              onChange={(e) => setMaxBudgetUsd(e.target.value)}
              className="font-mono tabular-nums"
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Agent-wide budget caps"
        description="Spend caps that apply across every session this agent runs."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Daily cap"
            htmlFor="daily-budget"
            description="USD. Resets at UTC midnight. Blocks new turns once reached."
          >
            <Input
              id="daily-budget"
              type="number"
              min={1}
              value={dailyBudgetUsd}
              onChange={(e) => setDailyBudgetUsd(e.target.value)}
              className="font-mono tabular-nums"
              placeholder="no cap"
            />
          </Field>
          <Field
            label="Monthly cap"
            htmlFor="monthly-budget"
            description="USD. Resets on UTC 1st-of-month."
          >
            <Input
              id="monthly-budget"
              type="number"
              min={1}
              value={monthlyBudgetUsd}
              onChange={(e) => setMonthlyBudgetUsd(e.target.value)}
              className="font-mono tabular-nums"
              placeholder="no cap"
            />
          </Field>
        </div>
      </Section>

      <Section title="Tools">
        <RadioRow
          name="toolMode"
          options={[
            { value: "all", label: "All built-in tools" },
            { value: "only", label: "Only selected" },
          ]}
          value={toolMode}
          onChange={(v) => setToolMode(v as "all" | "only")}
        />
        {toolMode === "only" ? (
          <ToolGrid
            tools={BUILTIN_TOOLS}
            selected={selectedTools}
            onToggle={toggleTool}
          />
        ) : null}
      </Section>

      <Section
        title="Skills"
        description="Materialized into the per-session worktree's .claude/skills/ before the agent runs. The agent loads them lazily based on each skill's description."
      >
        <RadioRow
          name="skillMode"
          options={[
            { value: "all", label: "All visible" },
            { value: "selected", label: "Only selected" },
            { value: "none", label: "None" },
          ]}
          value={skillMode}
          onChange={(v) => setSkillMode(v as "all" | "selected" | "none")}
        />
        {skillMode === "selected" ? (
          availableSkills.length === 0 ? (
            <p className="text-[12px] text-fg-muted italic">
              No skills available. Create some under{" "}
              <a href="/skills" className="underline hover:text-fg">
                Skills
              </a>{" "}
              first.
            </p>
          ) : (
            <SkillGrid
              skills={availableSkills}
              selected={selectedSkillIds}
              onToggle={toggleSkill}
            />
          )
        ) : null}
      </Section>

      <Section title="Integrations">
        <div className="space-y-3">
          <CheckboxRow
            checked={includeProjectSkills}
            onChange={setIncludeProjectSkills}
            label={
              <>
                Use repo&apos;s{" "}
                <code className="font-mono text-[12px]">
                  .claude/settings.json
                </code>{" "}
                (skills + hooks)
              </>
            }
          />
          <CheckboxRow
            checked={enableLinearTools}
            onChange={setEnableLinearTools}
            label={
              <>
                Linear MCP tools — expose{" "}
                <code className="font-mono text-[12px]">linear_*</code> tools.
                Wire pickup status → agent rules under{" "}
                <a href="/pollers" className="underline hover:text-fg">
                  Pollers
                </a>
                .
              </>
            }
          />
          <CheckboxRow
            checked={enableGithubTools}
            onChange={setEnableGithubTools}
            label={
              <>
                GitHub MCP tools — expose{" "}
                <code className="font-mono text-[12px]">git_*</code> /{" "}
                <code className="font-mono text-[12px]">gh_*</code> tools
                (worktrees, push, create PR; requires{" "}
                <code className="font-mono text-[12px]">gh</code> CLI authed
                on server)
              </>
            }
          />
          <CheckboxRow
            checked={enableAgentTools}
            onChange={setEnableAgentTools}
            label={
              <>
                Agent delegation tools — expose{" "}
                <code className="font-mono text-[12px]">agent_*</code> tools
                (spawn / wait / message sub-agent sessions). Makes this agent
                an orchestrator.
              </>
            }
          />
          <CheckboxRow
            checked={enableEventTools}
            onChange={setEnableEventTools}
            label={
              <>
                Event tools — expose{" "}
                <code className="font-mono text-[12px]">event_*</code> tools
                (emit / recent). Lets this agent publish onto the{" "}
                <a href="/events" className="underline hover:text-fg">
                  event bus
                </a>
                .
              </>
            }
          />
        </div>
      </Section>

      <Section
        title="Approval policy"
        description="When set, the agent must wait for you to approve flagged tool calls. Auto-denies after the timeout."
      >
        <RadioRow
          name="approvalMode"
          options={[
            { value: "none", label: "None — bypass everything" },
            { value: "list", label: "Selected tools only" },
            { value: "all", label: "Every tool call" },
          ]}
          value={approvalMode}
          onChange={(v) => setApprovalMode(v as "none" | "list" | "all")}
        />
        {approvalMode === "list" ? (
          <ToolGrid
            tools={BUILTIN_TOOLS}
            selected={approvalTools}
            onToggle={toggleApprovalTool}
          />
        ) : null}
        {approvalMode !== "none" ? (
          <Field
            label="Timeout"
            htmlFor="approvalTimeout"
            description="Seconds the agent waits for your decision before auto-denying."
            className="max-w-[200px]"
          >
            <Input
              id="approvalTimeout"
              type="number"
              min={5}
              max={3600}
              value={approvalTimeoutSeconds}
              onChange={(e) =>
                setApprovalTimeoutSeconds(Number(e.target.value))
              }
              className="font-mono tabular-nums"
            />
          </Field>
        ) : null}
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
          onClick={() => router.push("/agents")}
        >
          Cancel
        </Button>
        <Button type="submit" loading={submitting} disabled={submitting}>
          {mode === "create" ? "Create agent" : "Save changes"}
        </Button>
      </div>
    </form>
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

function RadioRow({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
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
          </label>
        );
      })}
    </div>
  );
}

function SkillGrid({
  skills,
  selected,
  onToggle,
}: {
  skills: SkillOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {skills.map((skill) => {
        const active = selected.includes(skill.id);
        return (
          <button
            key={skill.id}
            type="button"
            onClick={() => onToggle(skill.id)}
            className={cn(
              "inline-flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl",
              "text-left ring-1 transition-colors duration-150",
              active
                ? "bg-accent-soft text-accent ring-[color:var(--accent-soft)]"
                : "bg-surface-2 text-fg-muted ring-hairline hover:text-fg",
            )}
          >
            <span className="text-[13px] font-medium truncate w-full">
              {skill.name}
            </span>
            <span className="text-[11px] font-mono text-fg-subtle truncate w-full">
              {skill.slug}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ToolGrid({
  tools,
  selected,
  onToggle,
}: {
  tools: string[];
  selected: string[];
  onToggle: (t: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {tools.map((tool) => {
        const active = selected.includes(tool);
        return (
          <button
            key={tool}
            type="button"
            onClick={() => onToggle(tool)}
            className={cn(
              "inline-flex items-center justify-center gap-2 h-9 px-3 rounded-xl",
              "text-[12px] font-mono ring-1 transition-colors duration-150",
              active
                ? "bg-accent-soft text-accent ring-[color:var(--accent-soft)]"
                : "bg-surface-2 text-fg-muted ring-hairline hover:text-fg",
            )}
          >
            {tool}
          </button>
        );
      })}
    </div>
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
