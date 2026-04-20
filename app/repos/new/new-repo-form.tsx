"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";

export function NewRepoForm({
  teams,
}: {
  teams: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [teamId, setTeamId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim().toLowerCase(),
          githubRepo: githubRepo.trim(),
          teamId: teamId || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      router.push("/repos");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  // Auto-suggest a slug from the GitHub repo's name when the user
  // hasn't typed one yet — saves a step in the common case.
  function handleGithubChange(value: string) {
    setGithubRepo(value);
    if (!slug) {
      const lastSegment = value.split("/").pop() ?? "";
      setSlug(
        lastSegment
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40),
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Card>
        <div className="space-y-5">
          <Field
            label="GitHub repo"
            htmlFor="ghr"
            description="Format: owner/name (e.g. Pontifexx-Tech/paddock-app)."
            required
          >
            <Input
              id="ghr"
              required
              value={githubRepo}
              onChange={(e) => handleGithubChange(e.target.value)}
              placeholder="owner/name"
              className="font-mono"
            />
          </Field>

          <Field
            label="Slug"
            htmlFor="slug"
            description="Lowercase identifier shown in dropdowns + used as the on-disk dirname under data/repos/."
            required
          >
            <Input
              id="slug"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-app"
              pattern="[a-z0-9][a-z0-9-]*"
              className="font-mono"
            />
          </Field>

          {teams.length > 0 ? (
            <Field
              label="Team"
              htmlFor="team"
              description="Optional — share the repo with a team so any member can use it in new sessions."
            >
              <Select
                id="team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">Personal (just me)</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
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
          Clone repo
        </Button>
      </div>
    </form>
  );
}
