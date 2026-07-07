"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SparkleIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Markdown } from "@/components/chat/Markdown";

export interface DraftRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  teamId: string | null;
  repoId: string | null;
  repoSlug: string | null;
  sourceSessionId: string | null;
  createdAt: string;
}

export function SkillDraftsReview({
  initial,
  onCountChange,
}: {
  initial: DraftRow[];
  onCountChange?: (n: number) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    onCountChange?.(rows.length);
  }, [rows.length, onCountChange]);

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id);
    // Optimistic — drop the card immediately, restore on failure.
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/skill-drafts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        setRows(prev);
        return;
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
      setRows(prev);
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<SparkleIcon weight="regular" className="h-5 w-5" />}
        title="No drafts to review"
        description="Agents distill what they learn — approve drafts to teach every future session. Drafts appear automatically a while after sessions finish."
      />
    );
  }

  return (
    <ul className="space-y-3">
      <AnimatePresence initial={false}>
        {rows.map((d) => (
          <motion.li
            key={d.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 px-5 py-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-medium text-fg truncate">
                    {d.name}
                  </span>
                  <Badge>
                    <span className="font-mono normal-case">{d.slug}</span>
                  </Badge>
                  {d.repoId ? (
                    <Badge tone="accent">
                      <span className="normal-case">
                        {d.repoSlug ?? "repo"}
                      </span>
                    </Badge>
                  ) : (
                    <Badge>global</Badge>
                  )}
                  {d.teamId ? <Badge>Team</Badge> : null}
                </div>
                <p className="mt-1 text-[12px] text-fg-muted line-clamp-2 leading-relaxed">
                  {d.description}
                </p>
                {d.sourceSessionId ? (
                  <Link
                    href={`/sessions/${d.sourceSessionId}`}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
                  >
                    <ArrowSquareOutIcon className="h-3 w-3" />
                    source session
                  </Link>
                ) : null}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  disabled={busyId === d.id}
                  loading={busyId === d.id}
                  onClick={() => act(d.id, "approve")}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyId === d.id}
                  onClick={() => act(d.id, "reject")}
                >
                  Reject
                </Button>
              </div>
            </div>
            <details className="mt-3 group">
              <summary className="cursor-pointer text-[12px] text-fg-subtle hover:text-fg select-none">
                Preview body
              </summary>
              <div className="mt-2 rounded-xl bg-surface-2/40 ring-1 ring-hairline px-4 py-3 max-h-96 overflow-auto">
                <Markdown>{d.body}</Markdown>
              </div>
            </details>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
