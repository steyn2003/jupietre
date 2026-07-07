"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PackageIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Textarea } from "@/components/ui/Field";

export interface BundleRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  skillIds: string[];
  instruction: string;
  ownerId: string;
}

export interface BundleSkillOption {
  id: string;
  slug: string;
  name: string;
}

export function BundlesTab({
  currentUserId,
  initial,
  skillOptions,
  onCountChange,
}: {
  currentUserId: string;
  initial: BundleRow[];
  skillOptions: BundleSkillOption[];
  onCountChange?: (n: number) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  // null = list view, "new" = create form, otherwise the bundle id being edited
  const [editing, setEditing] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const skillBySlug = new Map(skillOptions.map((s) => [s.id, s.slug]));

  function setAll(next: BundleRow[]) {
    setRows(next);
    onCountChange?.(next.length);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete bundle "${name}"? Member skills are not deleted.`))
      return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/skill-bundles/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setAll(rows.filter((x) => x.id !== id));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (editing !== null) {
    const bundle = rows.find((b) => b.id === editing) ?? null;
    return (
      <BundleForm
        bundle={bundle}
        skillOptions={skillOptions}
        onDone={(saved) => {
          if (saved) {
            setAll(
              bundle
                ? rows.map((b) => (b.id === saved.id ? saved : b))
                : [...rows, saved],
            );
            router.refresh();
          }
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing("new")}>
          New bundle
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<PackageIcon weight="regular" className="h-5 w-5" />}
          title="No bundles yet"
          description="A bundle groups existing skills under one slug (Hermes-style). Agents invoke the bundle and it loads all member skills at once — keep skills small and focused, compose them here."
          action={
            <Button onClick={() => setEditing("new")}>
              Create your first bundle
            </Button>
          }
        />
      ) : (
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {rows.map((b) => {
            const mine = b.ownerId === currentUserId;
            return (
              <li
                key={b.id}
                className="flex items-start justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-medium text-fg truncate">
                      {b.name}
                    </span>
                    <Badge>
                      <span className="font-mono normal-case">{b.slug}</span>
                    </Badge>
                    <Badge tone="accent">
                      <span className="normal-case">
                        {b.skillIds.length} skill
                        {b.skillIds.length === 1 ? "" : "s"}
                      </span>
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-fg-muted line-clamp-2 leading-relaxed">
                    {b.description}
                  </p>
                  <p className="mt-1 text-[11px] font-mono text-fg-subtle truncate">
                    {b.skillIds
                      .map((id) => skillBySlug.get(id) ?? "(deleted)")
                      .join(" + ")}
                  </p>
                </div>
                {mine ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing(b.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busyId === b.id}
                      loading={busyId === b.id}
                      onClick={() => handleDelete(b.id, b.name)}
                    >
                      Delete
                    </Button>
                  </div>
                ) : (
                  <span className="text-[11px] text-fg-subtle italic shrink-0">
                    shared
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BundleForm({
  bundle,
  skillOptions,
  onDone,
}: {
  bundle: BundleRow | null;
  skillOptions: BundleSkillOption[];
  onDone: (saved: BundleRow | null) => void;
}) {
  const [slug, setSlug] = useState(bundle?.slug ?? "");
  const [name, setName] = useState(bundle?.name ?? "");
  const [description, setDescription] = useState(bundle?.description ?? "");
  const [instruction, setInstruction] = useState(bundle?.instruction ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(bundle?.skillIds ?? []),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) {
      setError("Pick at least one member skill");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        description,
        instruction,
        skillIds: [...selected],
      };
      if (!bundle) payload.slug = slug;
      const res = await fetch(
        bundle ? `/api/skill-bundles/${bundle.id}` : "/api/skill-bundles",
        {
          method: bundle ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        bundle?: BundleRow;
        error?: string;
      } | null;
      if (!res.ok || !data?.bundle) {
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      onDone(data.bundle);
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
              {bundle ? "Edit bundle" : "New bundle"}
            </h2>
            <p className="text-[12px] text-fg-muted mt-1 leading-relaxed">
              Groups existing skills under one slug. When an agent invokes the
              bundle it loads all member skills at once, plus the extra
              instruction below.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="b-name" required>
              <Input
                id="b-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Backend dev workflow"
              />
            </Field>
            <Field
              label="Slug"
              htmlFor="b-slug"
              required
              description="kebab-case, unique per owner. Overwrites a same-slug skill on materialization."
            >
              <Input
                id="b-slug"
                required
                disabled={bundle !== null}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                pattern="[a-z0-9-]+"
                className="font-mono"
                placeholder="backend-dev"
              />
            </Field>
          </div>
          <Field
            label="Description"
            htmlFor="b-desc"
            required
            description="Discovery hint the agent reads to decide when to load this bundle."
          >
            <Textarea
              id="b-desc"
              required
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Backend feature work — review, test, PR workflow."
            />
          </Field>
          <Field
            label="Member skills"
            htmlFor="b-skills"
            required
            description="Members that don't flow into a session (repo scope, agent allowlist) are dropped from the bundle there."
          >
            <div
              id="b-skills"
              className="max-h-64 overflow-y-auto rounded-xl border border-hairline divide-y divide-hairline"
            >
              {skillOptions.length === 0 ? (
                <p className="px-3.5 py-3 text-[12px] text-fg-muted">
                  No skills yet — create some in the Library tab first.
                </p>
              ) : (
                skillOptions.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 px-3.5 py-2.5 text-[13px] text-fg cursor-pointer hover:bg-surface-1"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-fg-subtle">
                      {s.slug}
                    </span>
                  </label>
                ))
              )}
            </div>
          </Field>
          <Field
            label="Instruction (optional)"
            htmlFor="b-instr"
            description="Glue text appended after the member list — ordering, hard rules, workflow."
          >
            <Textarea
              id="b-instr"
              rows={4}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              className="font-mono text-[12px]"
              placeholder="Always start by writing failing tests, then implement."
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
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting} disabled={submitting}>
          {bundle ? "Save changes" : "Create bundle"}
        </Button>
      </div>
    </form>
  );
}
