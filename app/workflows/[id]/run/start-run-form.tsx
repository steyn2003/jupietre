"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";

interface RepoOption {
  id: string;
  slug: string;
  githubRepo: string;
}

export function StartRunForm({
  workflowId,
  repos,
  entryNode,
}: {
  workflowId: string;
  repos: RepoOption[];
  entryNode: string | null;
}) {
  const router = useRouter();
  const [repoId, setRepoId] = useState(repos[0]?.id ?? "");
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!entryNode) {
      setError("Workflow has no entry node.");
      return;
    }
    if (!repoId) {
      setError("Pick a repo.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId, goal }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        run?: { id: string };
      } | null;
      if (!res.ok) {
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      if (data?.run?.id) {
        router.push(`/workflow-runs/${data.run.id}`);
      } else {
        router.push("/workflows");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      <Field label="Repo" required>
        <select
          value={repoId}
          onChange={(e) => setRepoId(e.target.value)}
          required
          className="w-full rounded-xl border border-hairline bg-surface-1 px-3 h-11 text-sm"
        >
          {repos.length === 0 ? (
            <option value="">(no repos — add one under /repos)</option>
          ) : null}
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.slug} — {r.githubRepo}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Goal"
        required
        description="Short plain-language description of what the run should accomplish. This is the first message sent to the entry-node agent."
      >
        <Textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={5}
          required
          placeholder="e.g. Add a PWA install prompt to the sessions page, gated behind the pwa-prompt feature flag."
        />
      </Field>

      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-2 text-[13px]">
          <strong>Error:</strong> {error}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" loading={submitting} disabled={!entryNode}>
          Start run
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
