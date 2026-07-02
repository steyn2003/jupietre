"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { UsersThreeIcon, RobotIcon, CheckIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

interface TeamCard {
  slug: string;
  name: string;
  tagline: string;
  leadSlug: string;
  leadName: string;
  members: Array<{ slug: string; name: string }>;
  installed: boolean;
}

interface AgentCard {
  slug: string;
  name: string;
  tagline: string;
  category: string;
  model: string;
  installed: boolean;
}

export function MarketClient({
  teams,
  agents,
}: {
  teams: TeamCard[];
  agents: AgentCard[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function install(kind: "agent" | "team", slug: string) {
    setBusy(`${kind}:${slug}`);
    try {
      const res = await fetch("/api/market/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, slug }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[14px] font-medium text-fg tracking-tight">
          <UsersThreeIcon weight="regular" className="h-4 w-4" />
          Teams
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((t) => (
            <Card key={t.slug}>
              <div className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-medium text-fg tracking-tight">
                    {t.name}
                  </h3>
                  {t.installed ? (
                    <Badge tone="accent">
                      <CheckIcon weight="bold" className="h-3 w-3" /> installed
                    </Badge>
                  ) : null}
                </div>
                <p className="text-[12px] leading-relaxed text-fg-muted">
                  {t.tagline}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="accent">
                    <span className="font-mono normal-case">{t.leadSlug}</span>
                  </Badge>
                  {t.members.map((m) => (
                    <Badge key={m.slug}>
                      <span className="font-mono normal-case">{m.slug}</span>
                    </Badge>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-end gap-2 pt-1">
                  {t.installed ? (
                    <Link href="/sessions/new">
                      <Button variant="secondary" size="sm">
                        Start with {t.leadName}
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      size="sm"
                      loading={busy === `team:${t.slug}`}
                      disabled={busy !== null}
                      onClick={() => install("team", t.slug)}
                    >
                      Install team
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[14px] font-medium text-fg tracking-tight">
          <RobotIcon weight="regular" className="h-4 w-4" />
          Agents
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.slug}>
              <div className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-medium text-fg tracking-tight">
                    {a.name}
                  </h3>
                  {a.installed ? (
                    <Badge tone="accent">
                      <CheckIcon weight="bold" className="h-3 w-3" /> installed
                    </Badge>
                  ) : null}
                </div>
                <p className="text-[12px] leading-relaxed text-fg-muted">
                  {a.tagline}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{a.category}</Badge>
                  <Badge>
                    <span className="font-mono normal-case">{a.model}</span>
                  </Badge>
                </div>
                <div className="mt-auto flex items-center justify-end pt-1">
                  {a.installed ? (
                    <Link href="/agents">
                      <Button variant="secondary" size="sm">
                        View in Agents
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      size="sm"
                      loading={busy === `agent:${a.slug}`}
                      disabled={busy !== null}
                      onClick={() => install("agent", a.slug)}
                    >
                      Install
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
