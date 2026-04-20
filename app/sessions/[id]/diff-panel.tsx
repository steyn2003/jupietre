"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CaretDownIcon,
  GitBranchIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/components/ui/cn";
import { FileView } from "./file-view";

type RepoDiff = {
  branch: string | null;
  changedFiles: Array<{ status: string; path: string }>;
  diff: string;
  truncated: boolean;
  recentCommits: Array<{ hash: string; subject: string; when: string }>;
  worktrees: string[];
  error: string | null;
};

export function DiffPanel({
  sessionId,
  running,
}: {
  sessionId: string;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RepoDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/diff`);
      if (res.ok) setData((await res.json()) as RepoDiff);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    refresh();
    if (!running) return;
    const i = setInterval(refresh, 5_000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, running, sessionId]);

  const changedCount = data?.changedFiles.length ?? 0;

  return (
    <div className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-[13px] hover:bg-surface-2/40 transition-colors duration-150"
      >
        <span className="flex items-center gap-2.5">
          <GitBranchIcon
            weight="regular"
            className="h-4 w-4 text-fg-muted"
          />
          <span className="font-medium text-fg">Diff</span>
          {data?.branch ? (
            <Badge>
              <span className="font-mono normal-case">{data.branch}</span>
            </Badge>
          ) : null}
          {changedCount > 0 ? (
            <Badge tone="accent">{changedCount} changed</Badge>
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
            <div className="border-t border-hairline px-5 py-4 text-[12px] space-y-4">
              {loading && !data ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : null}
              {data?.error ? (
                <p className="text-danger">{data.error}</p>
              ) : null}
              {data && !data.error ? (
                <>
                  {data.worktrees.length > 1 ? (
                    <Section label="Worktrees">
                      <ul className="space-y-1 text-fg-muted">
                        {data.worktrees.map((w) => (
                          <li key={w} className="truncate font-mono">
                            {w}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  ) : null}
                  {data.recentCommits.length > 0 ? (
                    <Section label="Recent commits">
                      <ul className="space-y-1">
                        {data.recentCommits.map((c) => (
                          <li
                            key={c.hash}
                            className="flex gap-3 items-baseline"
                          >
                            <span className="font-mono text-fg-subtle text-[11px]">
                              {c.hash}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-fg">
                              {c.subject}
                            </span>
                            <span className="text-fg-subtle text-[11px] tabular-nums shrink-0">
                              {c.when}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  ) : null}
                  {data.changedFiles.length > 0 ? (
                    <>
                      <Section label="Changed files">
                        <ul className="space-y-0.5 font-mono">
                          {[...data.changedFiles]
                            .sort((a, b) => a.path.localeCompare(b.path))
                            .map((f) => {
                              const isSelected = selectedFile === f.path;
                              return (
                                <li key={f.path}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedFile(
                                        isSelected ? null : f.path,
                                      )
                                    }
                                    className={cn(
                                      "flex w-full items-center gap-3 rounded px-1.5 py-1 text-left transition",
                                      isSelected
                                        ? "bg-surface-3 text-fg"
                                        : "text-fg hover:bg-surface-2/60",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "w-6 shrink-0 font-mono",
                                        isSelected
                                          ? "text-accent-strong"
                                          : "text-accent",
                                      )}
                                    >
                                      {f.status}
                                    </span>
                                    <span className="truncate">{f.path}</span>
                                  </button>
                                </li>
                              );
                            })}
                        </ul>
                      </Section>
                      {selectedFile ? (
                        <div className="space-y-2 rounded-lg ring-1 ring-hairline bg-surface-2/40 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <code className="truncate text-[11px] font-mono text-fg">
                              {selectedFile}
                            </code>
                            <button
                              type="button"
                              onClick={() => setSelectedFile(null)}
                              className="rounded p-1 text-fg-subtle hover:text-fg hover:bg-surface-3 transition"
                              title="Close file"
                            >
                              <XIcon weight="bold" className="h-3 w-3" />
                            </button>
                          </div>
                          <FileView
                            sessionId={sessionId}
                            filePath={selectedFile}
                          />
                        </div>
                      ) : (
                        <p className="text-fg-subtle text-[11px]">
                          Click a file to see its diff and current contents.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-fg-muted">
                      No uncommitted changes in the working tree.
                    </p>
                  )}
                </>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle font-medium">
        {label}
      </div>
      {children}
    </div>
  );
}
