"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  KanbanIcon,
  GithubLogoIcon,
  PlugsConnectedIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";

type Kind = "linear" | "github" | "mcp";

interface PublicConfigStdio {
  transport: "stdio";
  command: string;
  args: string[];
}
interface PublicConfigHttp {
  transport: "http";
  url: string;
  headerKeys: string[];
}

export interface ConnectionRow {
  id: string;
  ownerId: string;
  teamId: string | null;
  kind: Kind;
  name: string;
  slug: string;
  hasSecret: boolean;
  lastFour: string | null;
  publicConfig: PublicConfigStdio | PublicConfigHttp | null;
  canEdit: boolean;
  grantedAgents: { id: string; name: string }[];
}

const KIND_META: Record<
  Kind,
  { label: string; icon: React.ReactNode; tone: string }
> = {
  linear: {
    label: "Linear",
    icon: <KanbanIcon weight="fill" className="h-3.5 w-3.5" />,
    tone: "rgb(168,85,247)",
  },
  github: {
    label: "GitHub",
    icon: <GithubLogoIcon weight="fill" className="h-3.5 w-3.5" />,
    tone: "var(--fg-muted)",
  },
  mcp: {
    label: "MCP",
    icon: <PlugsConnectedIcon weight="fill" className="h-3.5 w-3.5" />,
    tone: "rgb(20,184,166)",
  },
};

export function ConnectionsManager({
  initial,
  teams,
  currentUserId,
}: {
  initial: ConnectionRow[];
  teams: Array<{ id: string; name: string }>;
  currentUserId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(r: ConnectionRow) {
    if (
      !confirm(
        `Delete connection "${r.name}"?\n\nAgents currently granted it will lose access immediately. This cannot be undone.`,
      )
    )
      return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/connections/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        {creating ? null : (
          <Button
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            trailingIcon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
          >
            New connection
          </Button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {creating ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <ConnectionForm
              mode="create"
              teams={teams}
              onCancel={() => setCreating(false)}
              onSaved={() => {
                setCreating(false);
                router.refresh();
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {rows.length === 0 && !creating ? (
        <EmptyState
          icon={<PlugsConnectedIcon weight="regular" className="h-5 w-5" />}
          title="No connections yet"
          description="Register a Linear workspace, a GitHub token, or an external MCP server, then grant it to the agents that need it."
          action={
            <Button onClick={() => setCreating(true)}>
              Add your first connection
            </Button>
          }
        />
      ) : (
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {rows.map((r) => {
            const meta = KIND_META[r.kind];
            const owned = r.ownerId === currentUserId;
            const editing = editingId === r.id;
            return (
              <li key={r.id} className="px-5 py-4">
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-hairline"
                        style={{ color: meta.tone }}
                      >
                        {meta.icon}
                        {meta.label}
                      </span>
                      <span className="text-[14px] font-medium text-fg">
                        {r.name}
                      </span>
                      <Badge>
                        <span className="font-mono normal-case">{r.slug}</span>
                      </Badge>
                      {r.hasSecret && r.lastFour ? (
                        <Badge>
                          <span className="font-mono normal-case">
                            ••••{r.lastFour}
                          </span>
                        </Badge>
                      ) : null}
                      {r.teamId ? <Badge tone="accent">Team</Badge> : null}
                      {!owned ? <Badge>shared</Badge> : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap text-[12px] text-fg-muted">
                      {r.publicConfig?.transport === "stdio" ? (
                        <span className="font-mono text-fg-subtle truncate">
                          {r.publicConfig.command}{" "}
                          {r.publicConfig.args.join(" ")}
                        </span>
                      ) : null}
                      {r.publicConfig?.transport === "http" ? (
                        <span className="font-mono text-fg-subtle truncate">
                          {r.publicConfig.url}
                        </span>
                      ) : null}
                    </div>
                    {r.grantedAgents.length > 0 ? (
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-fg-subtle">
                          Granted to
                        </span>
                        {r.grantedAgents.map((a) => (
                          <Badge key={a.id}>{a.name}</Badge>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-[11px] text-fg-subtle italic">
                        Not granted to any agent yet.
                      </div>
                    )}
                  </div>
                  {r.canEdit ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setEditingId(editing ? null : r.id)
                        }
                      >
                        {editing ? "Close" : "Edit"}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busyId === r.id}
                        loading={busyId === r.id}
                        onClick={() => handleDelete(r)}
                        trailingIcon={
                          <TrashIcon weight="bold" className="h-3.5 w-3.5" />
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-fg-subtle italic shrink-0">
                      owner-only
                    </span>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {editing ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="pt-4"
                    >
                      <ConnectionForm
                        mode="edit"
                        teams={teams}
                        existing={r}
                        onCancel={() => setEditingId(null)}
                        onSaved={() => {
                          setEditingId(null);
                          router.refresh();
                        }}
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Create / edit form. Secrets are write-only: on edit the field starts
// empty with a "leave blank to keep" hint and is only sent when typed.
// ────────────────────────────────────────────────────────────────────

function ConnectionForm({
  mode,
  teams,
  existing,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  teams: Array<{ id: string; name: string }>;
  existing?: ConnectionRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<Kind>(existing?.kind ?? "linear");
  const [name, setName] = useState(existing?.name ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [teamId, setTeamId] = useState(existing?.teamId ?? "");

  // Secret fields — always start empty (write-only).
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");

  // mcp fields
  const stdio =
    existing?.publicConfig?.transport === "stdio"
      ? existing.publicConfig
      : null;
  const http =
    existing?.publicConfig?.transport === "http" ? existing.publicConfig : null;
  const [transport, setTransport] = useState<"stdio" | "http">(
    existing?.publicConfig?.transport ?? "stdio",
  );
  const [command, setCommand] = useState(stdio?.command ?? "");
  const [argsText, setArgsText] = useState((stdio?.args ?? []).join("\n"));
  const [url, setUrl] = useState(http?.url ?? "");
  const [headersText, setHeadersText] = useState(""); // write-only

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildConfig(): Record<string, unknown> | null {
    if (kind === "linear") {
      if (mode === "create" && !apiKey.trim()) {
        setError("API key is required.");
        return null;
      }
      return apiKey.trim() ? { apiKey: apiKey.trim() } : {};
    }
    if (kind === "github") {
      if (mode === "create" && !token.trim()) {
        setError("Token is required.");
        return null;
      }
      return token.trim() ? { token: token.trim() } : {};
    }
    // mcp
    if (transport === "stdio") {
      if (!command.trim()) {
        setError("Command is required.");
        return null;
      }
      const args = argsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return { transport: "stdio", command: command.trim(), args };
    }
    if (!url.trim()) {
      setError("URL is required.");
      return null;
    }
    const headers = parseHeaders(headersText);
    // On edit, omit headers when blank so the stored ones are preserved.
    const cfg: Record<string, unknown> = {
      transport: "http",
      url: url.trim(),
    };
    if (headers) cfg.headers = headers;
    return cfg;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const config = buildConfig();
    if (!config) return;

    setSubmitting(true);
    try {
      let res: Response;
      if (mode === "create") {
        res = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            name: name.trim(),
            slug: slug.trim().toLowerCase(),
            teamId: teamId || null,
            config,
          }),
        });
      } else {
        res = await fetch(`/api/connections/${existing!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            teamId: teamId || null,
            config,
          }),
        });
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-[14px] font-medium text-fg tracking-tight">
          {mode === "create" ? "New connection" : "Edit connection"}
        </h2>

        {mode === "create" ? (
          <Field label="Kind" htmlFor="kind" required>
            <Select
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              <option value="linear">Linear workspace</option>
              <option value="github">GitHub token</option>
              <option value="mcp">External MCP server</option>
            </Select>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ENG workspace"
            />
          </Field>
          {mode === "create" ? (
            <Field
              label="Slug"
              htmlFor="slug"
              required
              description="Unique per owner. MCP tools namespace under it."
            >
              <Input
                id="slug"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                pattern="[a-z0-9][a-z0-9-]*"
                className="font-mono"
                placeholder="eng-linear"
              />
            </Field>
          ) : null}
        </div>

        {kind === "linear" ? (
          <Field
            label="Linear API key"
            htmlFor="apiKey"
            required={mode === "create"}
            description={
              mode === "edit"
                ? "Leave blank to keep the stored key. Stored plaintext."
                : "Personal API key from Linear → Settings → API. Stored plaintext."
            }
          >
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono"
              placeholder={mode === "edit" ? "••••••••" : "lin_api_…"}
            />
          </Field>
        ) : null}

        {kind === "github" ? (
          <Field
            label="GitHub token"
            htmlFor="token"
            required={mode === "create"}
            description={
              mode === "edit"
                ? "Leave blank to keep the stored token."
                : "PAT with repo scope. Overrides env GITHUB_TOKEN for granted agents."
            }
          >
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono"
              placeholder={mode === "edit" ? "••••••••" : "ghp_…"}
            />
          </Field>
        ) : null}

        {kind === "mcp" ? (
          <div className="space-y-4">
            <Field label="Transport" htmlFor="transport" required>
              <Select
                id="transport"
                value={transport}
                onChange={(e) =>
                  setTransport(e.target.value as "stdio" | "http")
                }
              >
                <option value="stdio">stdio (spawn a subprocess)</option>
                <option value="http">http (remote endpoint)</option>
              </Select>
            </Field>
            {transport === "stdio" ? (
              <>
                <Field label="Command" htmlFor="command" required>
                  <Input
                    id="command"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    className="font-mono"
                    placeholder="npx"
                  />
                </Field>
                <Field
                  label="Args"
                  htmlFor="args"
                  description="One per line."
                >
                  <Textarea
                    id="args"
                    rows={4}
                    value={argsText}
                    onChange={(e) => setArgsText(e.target.value)}
                    className="font-mono text-[12px]"
                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/data"}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="URL" htmlFor="url" required>
                  <Input
                    id="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="font-mono"
                    placeholder="https://mcp.example.com/sse"
                  />
                </Field>
                <Field
                  label="Headers"
                  htmlFor="headers"
                  description={
                    mode === "edit"
                      ? "One per line as `Key: Value`. Leave blank to keep stored headers."
                      : "One per line as `Key: Value` (e.g. Authorization: Bearer …)."
                  }
                >
                  <Textarea
                    id="headers"
                    rows={3}
                    value={headersText}
                    onChange={(e) => setHeadersText(e.target.value)}
                    className="font-mono text-[12px]"
                    placeholder={
                      mode === "edit"
                        ? existing?.publicConfig?.transport === "http" &&
                          existing.publicConfig.headerKeys.length > 0
                          ? `stored: ${existing.publicConfig.headerKeys.join(", ")}`
                          : "Authorization: Bearer …"
                        : "Authorization: Bearer …"
                    }
                  />
                </Field>
              </>
            )}
          </div>
        ) : null}

        {teams.length > 0 ? (
          <Field
            label="Team"
            htmlFor="team"
            description="Optional — share with a team so any member can grant it."
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

        {error ? <p className="text-[12px] text-danger">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={submitting}>
            {mode === "create" ? "Create connection" : "Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Parse a "Key: Value" per-line block. Returns null when empty (→ keep). */
function parseHeaders(text: string): Record<string, string> | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const out: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}
