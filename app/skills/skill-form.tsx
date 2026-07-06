"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Textarea } from "@/components/ui/Field";

export interface SkillFormInitial {
  id?: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  repoId: string | null;
}

export interface RepoOption {
  id: string;
  slug: string;
}

export function SkillForm({
  mode,
  initial,
  repos,
}: {
  mode: "create" | "edit";
  initial: SkillFormInitial;
  repos: RepoOption[];
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(initial.slug);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [body, setBody] = useState(initial.body);
  const [repoId, setRepoId] = useState<string>(initial.repoId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        description,
        body,
        repoId: repoId === "" ? null : repoId,
      };
      if (mode === "create") payload.slug = slug;

      const url = mode === "create" ? "/api/skills" : `/api/skills/${initial.id}`;
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
      router.push("/skills");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <div className="space-y-4">
          <div>
            <h2 className="text-[14px] font-medium text-fg tracking-tight">
              Identity
            </h2>
            <p className="text-[12px] text-fg-muted mt-1 leading-relaxed">
              The slug becomes the directory under{" "}
              <code className="font-mono text-[12px]">.claude/skills/</code>{" "}
              when materialized. The description is what the agent reads to
              decide whether this skill applies — be specific.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" required>
              <Input
                id="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Brainstorming Ideas Into Designs"
              />
            </Field>
            <Field
              label="Slug"
              htmlFor="slug"
              required
              description="kebab-case, unique per owner. Becomes the directory name."
            >
              <Input
                id="slug"
                required
                disabled={mode === "edit"}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                pattern="[a-z0-9-]+"
                className="font-mono"
                placeholder="brainstorming"
              />
            </Field>
          </div>
          <Field
            label="Description"
            htmlFor="desc"
            required
            description="Skill-discovery hint shown to the agent. The agent only loads the body when this description matches its current task."
          >
            <Textarea
              id="desc"
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Use this before any creative work — creating features, building components, adding functionality, or modifying behavior."
            />
          </Field>
          <Field
            label="Repo scope"
            htmlFor="repo"
            description="Global skills materialize into every session. Scope to a repo to only load this skill in sessions bound to that repo."
          >
            <select
              id="repo"
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
              className="w-full rounded-xl bg-surface-1 border border-hairline px-3.5 h-11 text-sm text-fg transition-colors duration-150 hover:border-strong focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-accent-soft"
            >
              <option value="">Global (all repos)</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.slug}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          <div>
            <h2 className="text-[14px] font-medium text-fg tracking-tight">
              Body (markdown)
            </h2>
            <p className="text-[12px] text-fg-muted mt-1 leading-relaxed">
              Everything after the frontmatter. The frontmatter (name +
              description) is auto-synthesized at materialization time — write
              just the body here.
            </p>
          </div>
          <Field label="Markdown" htmlFor="body" required>
            <Textarea
              id="body"
              required
              rows={24}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="font-mono text-[12px]"
              placeholder={"# Heading\n\nWhen to use this skill, what to do, hard rules..."}
            />
          </Field>
        </div>
      </Card>

      {error ? (
        <p className="rounded-xl bg-danger-soft ring-1 ring-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/skills")}
        >
          Cancel
        </Button>
        <Button type="submit" loading={submitting} disabled={submitting}>
          {mode === "create" ? "Create skill" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
