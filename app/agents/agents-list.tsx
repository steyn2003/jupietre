"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RobotIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number | null;
  linearPickup: boolean;
  ownerId: string;
  teamId: string | null;
}

export function AgentsList({
  initial,
  currentUserId,
}: {
  initial: AgentRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete agent "${name}"? This cannot be undone.`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setRows((r) => r.filter((x) => x.id !== id));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<RobotIcon weight="regular" className="h-5 w-5" />}
        title="No agents yet"
        description="Agents are reusable role configurations — system prompt, model, tools, and budget. Create one before starting a session."
        action={
          <Link href="/agents/new">
            <Button>Create your first agent</Button>
          </Link>
        }
      />
    );
  }

  return (
    <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
      <AnimatePresence initial={false}>
        {rows.map((a) => {
          const mine = a.ownerId === currentUserId && a.teamId === null;
          return (
            <motion.li
              key={a.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-medium text-fg truncate">
                    {a.name}
                  </span>
                  <Badge>
                    <span className="font-mono normal-case">{a.slug}</span>
                  </Badge>
                  {a.teamId ? <Badge>Team</Badge> : null}
                  {a.linearPickup ? <Badge tone="accent">Linear</Badge> : null}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-fg-muted">
                  <span className="font-mono text-fg-subtle">{a.model}</span>
                  <span className="text-fg-subtle">·</span>
                  <span>{a.maxTurns} turns</span>
                  {a.maxBudgetUsd !== null ? (
                    <>
                      <span className="text-fg-subtle">·</span>
                      <span className="font-mono tabular-nums">
                        ${a.maxBudgetUsd} max
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {mine ? (
                  <>
                    <Link href={`/agents/${a.id}/edit`}>
                      <Button variant="secondary" size="sm">
                        Edit
                      </Button>
                    </Link>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busyId === a.id}
                      loading={busyId === a.id}
                      onClick={() => handleDelete(a.id, a.name)}
                    >
                      Delete
                    </Button>
                  </>
                ) : (
                  <span className="text-[11px] text-fg-subtle italic">
                    {a.teamId ? "owner-only" : "shared"}
                  </span>
                )}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
