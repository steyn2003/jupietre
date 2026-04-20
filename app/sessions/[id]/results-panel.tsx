"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CaretDownIcon,
  PackageIcon,
  ArrowSquareOutIcon,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";

type Kind =
  | "pr"
  | "commit"
  | "worktree"
  | "linear_comment"
  | "linear_issue"
  | "file_change";

interface Artifact {
  id: string;
  kind: Kind;
  title: string;
  url: string | null;
  summary: string | null;
  createdAt: string;
}

const KIND_ORDER: Kind[] = [
  "pr",
  "linear_comment",
  "linear_issue",
  "commit",
  "file_change",
  "worktree",
];

const KIND_LABEL: Record<Kind, string> = {
  pr: "Pull requests",
  commit: "Commits",
  worktree: "Worktrees",
  linear_comment: "Linear comments",
  linear_issue: "Linear issues",
  file_change: "Files touched",
};

export function ResultsPanel({
  sessionId,
  running,
}: {
  sessionId: string;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState<number>(0);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/artifacts`);
      if (res.ok) {
        const data = (await res.json()) as { artifacts: Artifact[] };
        setItems(data.artifacts);
        setTotalCount(data.artifacts.length);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    if (!running) return;
    const i = setInterval(refresh, 5_000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, running]);

  const grouped = new Map<Kind, Artifact[]>();
  for (const kind of KIND_ORDER) grouped.set(kind, []);
  for (const a of items) {
    const list = grouped.get(a.kind);
    if (list) list.push(a);
  }

  return (
    <div className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-[13px] hover:bg-surface-2/40 transition-colors duration-150"
      >
        <span className="flex items-center gap-2.5">
          <PackageIcon
            weight="regular"
            className="h-4 w-4 text-fg-muted"
          />
          <span className="font-medium text-fg">Results</span>
          {totalCount > 0 ? <Badge tone="accent">{totalCount}</Badge> : null}
          {loading ? (
            <span className="text-[11px] text-fg-subtle">syncing…</span>
          ) : null}
        </span>
        <CaretDownIcon
          weight="bold"
          className={cn(
            "h-3.5 w-3.5 text-fg-subtle transition-transform duration-300 ease-[var(--ease-spring)]",
            open && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-hairline px-5 py-4 space-y-5">
              {totalCount === 0 ? (
                <p className="text-center text-[12px] text-fg-subtle py-4">
                  No artifacts yet. Agents produce PRs, commits, Linear
                  comments, and touched files as they work.
                </p>
              ) : null}
              {KIND_ORDER.map((kind) => {
                const list = grouped.get(kind) ?? [];
                if (list.length === 0) return null;
                return (
                  <section key={kind} className="space-y-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle font-medium flex items-center gap-2">
                      <span>{KIND_LABEL[kind]}</span>
                      <span className="text-fg-subtle/70">·</span>
                      <span className="font-mono tabular-nums">
                        {list.length}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {list.map((a) => (
                        <li key={a.id} className="text-[13px] flex items-start gap-2 group/art">
                          {a.url ? (
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:text-accent-strong transition-colors inline-flex items-center gap-1.5"
                            >
                              {a.title}
                              <ArrowSquareOutIcon
                                weight="regular"
                                className="h-3 w-3 opacity-0 transition-opacity group-hover/art:opacity-100"
                              />
                            </a>
                          ) : (
                            <span className="font-mono text-[12px] text-fg">
                              {a.title}
                            </span>
                          )}
                          {a.summary ? (
                            <span className="text-[12px] text-fg-muted">
                              — {a.summary}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
