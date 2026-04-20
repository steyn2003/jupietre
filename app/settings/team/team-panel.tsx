"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CopyIcon,
  EnvelopeIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconButton } from "@/components/ui/IconButton";

interface Team {
  id: string;
  name: string;
}

interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  role: "owner" | "member";
  addedAt: string;
}

interface Invite {
  id: string;
  email: string;
  teamRole: "owner" | "member";
  url: string;
  expiresAt: string;
}

export function TeamPanel({
  team,
  isOwner,
  currentUserId,
  members,
  invites,
}: {
  team: Team | null;
  isOwner: boolean;
  currentUserId: string;
  members: Member[];
  invites: Invite[];
}) {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(d?.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!team) return;
    setError(null);
    setNewInviteUrl(null);
    setBusy(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          teamId: team.id,
          teamRole: inviteRole,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(d?.error ?? `Failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { invite: { url: string } };
      setNewInviteUrl(data.invite.url);
      setInviteEmail("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    if (!confirm("Revoke this invite?")) return;
    await fetch(`/api/invites/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function removeMember(userId: string) {
    const self = userId === currentUserId;
    if (!confirm(self ? "Leave this team?" : "Remove this member?")) return;
    if (!team) return;
    await fetch(`/api/teams/${team.id}/members/${userId}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
    } catch {
      // ignore
    }
  }

  if (!team) {
    return (
      <Card>
        <div className="space-y-4">
          <CardHeader
            title="Create a team"
            description="You're not in a team yet. Create one to invite others."
          />
          <form onSubmit={createTeam} className="flex items-end gap-2">
            <Field label="Team name" htmlFor="team-name" required className="flex-1">
              <Input
                id="team-name"
                required
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Voltage Studio"
              />
            </Field>
            <Button
              type="submit"
              disabled={busy || !teamName.trim()}
              loading={busy}
            >
              Create team
            </Button>
          </form>
          {error ? (
            <p className="rounded-xl bg-danger-soft ring-1 ring-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-medium text-fg tracking-tight">
              {team.name}
            </h2>
            <p className="mt-1 text-[12px] text-fg-muted">
              Team id:{" "}
              <code className="font-mono text-fg-subtle">{team.id}</code>
            </p>
          </div>
          {isOwner ? <Badge tone="accent">Owner</Badge> : null}
        </div>
      </Card>

      <section className="space-y-3">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle font-medium px-1">
          Members · {members.length}
        </h3>
        <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between gap-4 px-5 py-3.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-fg truncate">
                    {m.displayName ?? m.email}
                  </span>
                  {m.userId === currentUserId ? (
                    <span className="text-[11px] text-fg-subtle">(you)</span>
                  ) : null}
                  {m.role === "owner" ? <Badge tone="accent">Owner</Badge> : null}
                </div>
                <div className="text-[12px] text-fg-muted mt-0.5">
                  {m.email}
                </div>
              </div>
              {(isOwner || m.userId === currentUserId) ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => removeMember(m.userId)}
                >
                  {m.userId === currentUserId ? "Leave" : "Remove"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {isOwner ? (
        <Card>
          <div className="space-y-4">
            <CardHeader
              title="Invite someone"
              description="No SMTP wired up yet — copy the link and send it yourself."
            />
            <form
              onSubmit={sendInvite}
              className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2"
            >
              <Input
                required
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
              <Select
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as "owner" | "member")
                }
                className="sm:w-32"
              >
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </Select>
              <Button
                type="submit"
                disabled={busy || !inviteEmail}
                loading={busy}
                leadingIcon={<EnvelopeIcon weight="regular" className="h-4 w-4" />}
              >
                Invite
              </Button>
            </form>
            {newInviteUrl ? (
              <div className="rounded-xl ring-1 ring-[color:var(--accent-soft)] bg-accent-soft p-4 space-y-2">
                <p className="text-[13px] font-medium text-accent">
                  Invite link created
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-bg/50 px-3 py-2 font-mono text-[11px] text-fg">
                    {newInviteUrl}
                  </code>
                  <IconButton
                    aria-label="Copy invite link"
                    variant="surface"
                    onClick={() => copy(newInviteUrl, "new")}
                  >
                    {copiedId === "new" ? (
                      <CheckIcon weight="bold" />
                    ) : (
                      <CopyIcon weight="regular" />
                    )}
                  </IconButton>
                </div>
              </div>
            ) : null}
            {error ? (
              <p className="rounded-xl bg-danger-soft ring-1 ring-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-danger">
                {error}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {invites.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle font-medium px-1">
            Pending invites · {invites.length}
          </h3>
          <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-4 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] text-fg truncate">
                      {i.email}
                    </span>
                    <Badge>{i.teamRole}</Badge>
                  </div>
                  <div className="text-[12px] text-fg-muted mt-0.5">
                    expires {new Date(i.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leadingIcon={
                      copiedId === i.id ? (
                        <CheckIcon weight="bold" className="h-3.5 w-3.5" />
                      ) : (
                        <CopyIcon weight="regular" className="h-3.5 w-3.5" />
                      )
                    }
                    onClick={() => copy(i.url, i.id)}
                  >
                    {copiedId === i.id ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => revokeInvite(i.id)}
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
