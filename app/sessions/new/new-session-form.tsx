"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/components/ui/cn";

interface AgentOption {
  id: string;
  slug: string;
  name: string;
  teamId: string | null;
}

interface TeamOption {
  id: string;
  name: string;
}

interface RepoOption {
  id: string;
  slug: string;
  githubRepo: string;
  defaultBranch: string;
}

export function NewSessionForm({
  repos,
  agents,
  teams,
  initialAgentSlug,
}: {
  repos: RepoOption[];
  agents: AgentOption[];
  teams: TeamOption[];
  /** Preselect this agent (e.g. /sessions/new?agent=ship-lead from the market). */
  initialAgentSlug?: string | null;
}) {
  const router = useRouter();
  const [agentConfigId, setAgentConfigId] = useState<string>(
    agents.find((a) => a.slug === initialAgentSlug)?.id ??
      agents.find((a) => a.slug === "engineer")?.id ??
      agents[0]?.id ??
      "",
  );
  const [title, setTitle] = useState("");
  const [repoId, setRepoId] = useState<string>(repos[0]?.id ?? "");
  const selectedRepo = useMemo(
    () => repos.find((r) => r.id === repoId) ?? null,
    [repos, repoId],
  );
  const [baseBranch, setBaseBranch] = useState(
    repos[0]?.defaultBranch ?? "main",
  );
  const [firstMessage, setFirstMessage] = useState("");
  const [visibility, setVisibility] = useState<"private" | "team">(
    teams.length > 0 ? "team" : "private",
  );
  const [teamId, setTeamId] = useState<string>(teams[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleRepoChange(id: string) {
    setRepoId(id);
    const next = repos.find((r) => r.id === id);
    if (next) setBaseBranch(next.defaultBranch);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentConfigId,
          title: title || firstMessage.slice(0, 60),
          repoId,
          baseBranch: baseBranch.trim() || null,
          firstMessage,
          visibility,
          teamId: visibility === "team" ? teamId || null : null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/sessions/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  if (agents.length === 0) {
    return (
      <EmptyState
        title="No agents configured"
        description="You need at least one agent before starting a session."
        action={
          <Link href="/agents/new">
            <Button>Create an agent</Button>
          </Link>
        }
      />
    );
  }

  if (repos.length === 0) {
    return (
      <EmptyState
        title="No repos yet"
        description="Add a GitHub repo so Jupietre can clone it before you start a session."
        action={
          <Link href="/repos/new">
            <Button>Add a repo</Button>
          </Link>
        }
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Card>
        <div className="space-y-5">
          <Field label="Agent" htmlFor="agent" required>
            <Select
              id="agent"
              value={agentConfigId}
              onChange={(e) => setAgentConfigId(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.slug}){a.teamId ? " · team" : ""}
                </option>
              ))}
            </Select>
          </Field>

          {teams.length > 0 ? (
            <Field label="Visibility">
              <div className="flex flex-wrap gap-2">
                <VisibilityOption
                  active={visibility === "private"}
                  onClick={() => setVisibility("private")}
                  title="Private"
                  description="Just you"
                />
                <VisibilityOption
                  active={visibility === "team"}
                  onClick={() => setVisibility("team")}
                  title="Team"
                  description="Any member can read + reply"
                />
              </div>
              {visibility === "team" && teams.length > 1 ? (
                <Select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  className="mt-3"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              ) : null}
            </Field>
          ) : null}

          <Field label="Repo" htmlFor="repo" required>
            <Select
              id="repo"
              value={repoId}
              onChange={(e) => handleRepoChange(e.target.value)}
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.slug} ({r.githubRepo})
                </option>
              ))}
            </Select>
            {selectedRepo ? (
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                Default branch:{" "}
                <span className="font-mono">{selectedRepo.defaultBranch}</span>
              </p>
            ) : null}
          </Field>

          <Field
            label="Base branch"
            htmlFor="baseBranch"
            description="The session worktree is created off origin/<branch> after a fetch. Defaults to the repo's default branch."
          >
            <Input
              id="baseBranch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
              className="font-mono"
            />
          </Field>

          <Field
            label="Title"
            htmlFor="title"
            description="Auto-generated from the first message if blank."
          >
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Refactor the auth middleware"
            />
          </Field>

          <Field label="First message" htmlFor="msg" required>
            <Textarea
              id="msg"
              required
              rows={6}
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              placeholder="What should the agent do?"
            />
          </Field>
        </div>
      </Card>

      {error ? (
        <p className="rounded-xl bg-danger-soft ring-1 ring-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          loading={submitting}
          disabled={submitting}
          size="lg"
        >
          Start session
        </Button>
      </div>
    </form>
  );
}

function VisibilityOption({
  active,
  onClick,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 min-w-[160px] text-left rounded-xl px-4 py-3 ring-1 transition-colors duration-150",
        active
          ? "bg-accent-soft ring-[color:var(--accent-soft)]"
          : "bg-surface-2 ring-hairline hover:ring-strong",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            active ? "bg-accent" : "bg-fg-subtle",
          )}
        />
        <span
          className={cn(
            "text-[13px] font-medium",
            active ? "text-accent" : "text-fg",
          )}
        >
          {title}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-fg-muted ml-4">{description}</p>
    </button>
  );
}
