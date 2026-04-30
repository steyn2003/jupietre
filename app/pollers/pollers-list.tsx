"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { KanbanIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface PollerRow {
  id: string;
  name: string;
  teamKey: string | null;
  defaultLabel: string;
  pollIntervalMs: number;
  enabled: boolean;
  ownerId: string;
  teamId: string | null;
  ruleCount: number;
}

export function PollersList({
  initial,
  currentUserId,
}: {
  initial: PollerRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (
      !confirm(
        `Delete poller "${name}"? Its rules will also be removed. This cannot be undone.`,
      )
    )
      return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/pollers/${id}`, { method: "DELETE" });
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
        icon={<KanbanIcon weight="regular" className="h-5 w-5" />}
        title="No Linear pollers yet"
        description="Add one for each Linear workspace you want to drive. Configure which issue states map to which agents — the poller picks up matching tickets and creates a session."
        action={
          <Link href="/pollers/new">
            <Button>Create your first poller</Button>
          </Link>
        }
      />
    );
  }

  return (
    <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
      <AnimatePresence initial={false}>
        {rows.map((p) => {
          const mine = p.ownerId === currentUserId;
          return (
            <motion.li
              key={p.id}
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
                    {p.name}
                  </span>
                  {p.teamKey ? (
                    <Badge>
                      <span className="font-mono normal-case">{p.teamKey}</span>
                    </Badge>
                  ) : null}
                  {p.teamId ? <Badge>Team</Badge> : null}
                  {p.enabled ? (
                    <Badge tone="accent">enabled</Badge>
                  ) : (
                    <Badge>paused</Badge>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-fg-muted">
                  <span>
                    {p.ruleCount} rule{p.ruleCount === 1 ? "" : "s"}
                  </span>
                  <span className="text-fg-subtle">·</span>
                  <span>label</span>
                  <span className="font-mono text-fg-subtle">
                    {p.defaultLabel}
                  </span>
                  <span className="text-fg-subtle">·</span>
                  <span className="font-mono tabular-nums">
                    every {Math.round(p.pollIntervalMs / 1000)}s
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {mine ? (
                  <>
                    <Link href={`/pollers/${p.id}/edit`}>
                      <Button variant="secondary" size="sm">
                        Edit
                      </Button>
                    </Link>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busyId === p.id}
                      loading={busyId === p.id}
                      onClick={() => handleDelete(p.id, p.name)}
                    >
                      Delete
                    </Button>
                  </>
                ) : (
                  <span className="text-[11px] text-fg-subtle italic">
                    owner-only
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
