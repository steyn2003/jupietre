"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/components/ui/cn";

interface FilePayload {
  path: string;
  patch: string;
  patchHtml: string;
  currentContents: string;
  currentHtml: string;
  language: string;
  hunks: Array<{ header: string; oldStart: number; newStart: number }>;
  sizeBytes: number;
  error: "not-found" | "outside-repo" | "too-large" | "binary" | null;
  assistantTurns: number[];
}

type Tab = "patch" | "current";

export function FileView({
  sessionId,
  filePath,
}: {
  sessionId: string;
  filePath: string;
}) {
  const [data, setData] = useState<FilePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("patch");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setTab("patch");
    void (async () => {
      const res = await fetch(
        `/api/sessions/${sessionId}/diff/file?path=${encodeURIComponent(filePath)}`,
      );
      if (cancelled) return;
      if (res.ok) setData((await res.json()) as FilePayload);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, filePath]);

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between rounded-md bg-surface-1/90 backdrop-blur px-1 py-1">
        <div className="flex gap-1">
          <TabBtn active={tab === "patch"} onClick={() => setTab("patch")}>
            Patch
          </TabBtn>
          <TabBtn
            active={tab === "current"}
            onClick={() => setTab("current")}
          >
            Current file
          </TabBtn>
        </div>
        {data?.assistantTurns && data.assistantTurns.length > 0 ? (
          <div className="flex items-center gap-1">
            {data.assistantTurns.map((t) => (
              <Link
                key={t}
                href={`#msg-${t}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                  "text-[10px] font-mono text-fg-muted ring-1 ring-hairline",
                  "hover:text-fg hover:ring-strong transition",
                )}
                title={`Jump to assistant turn ${t}`}
              >
                <ArrowSquareOutIcon weight="bold" className="h-3 w-3" />
                turn {t}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : !data ? (
          <p className="text-[12px] text-fg-muted">Failed to load file.</p>
        ) : data.error === "too-large" ? (
          <Notice>File is too large to render ({fmtBytes(data.sizeBytes)}).</Notice>
        ) : data.error === "binary" ? (
          <Notice>Binary file ({fmtBytes(data.sizeBytes)}) — preview suppressed.</Notice>
        ) : data.error === "outside-repo" ? (
          <Notice tone="danger">Path resolves outside the repo.</Notice>
        ) : tab === "patch" ? (
          <motion.div
            key="patch"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {data.patch ? (
              <ShikiBlock html={data.patchHtml} />
            ) : (
              <Notice>No patch — file matches HEAD.</Notice>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="current"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {data.currentContents ? (
              <ShikiBlock html={data.currentHtml} withLineNumbers />
            ) : (
              <Notice>(file deleted)</Notice>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
        active
          ? "bg-surface-3 text-fg"
          : "text-fg-muted hover:text-fg hover:bg-surface-2/60",
      )}
    >
      {children}
    </button>
  );
}

function Notice({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <p
      className={cn(
        "rounded-lg ring-1 ring-hairline bg-bg/40 px-3 py-2 text-[12px]",
        tone === "danger" ? "text-danger" : "text-fg-muted",
      )}
    >
      {children}
    </p>
  );
}

function ShikiBlock({
  html,
  withLineNumbers,
}: {
  html: string;
  withLineNumbers?: boolean;
}) {
  return (
    <div
      className={cn(
        "max-h-[60vh] overflow-auto rounded-lg ring-1 ring-hairline bg-bg/60 p-3",
        "text-[11px] leading-relaxed font-mono",
        withLineNumbers && "[counter-reset:line] [&_.line]:before:content-[counter(line)]",
        withLineNumbers &&
          "[&_.line]:before:counter-increment-[line] [&_.line]:before:mr-4 [&_.line]:before:inline-block [&_.line]:before:w-8 [&_.line]:before:text-right [&_.line]:before:text-fg-subtle [&_.line]:before:select-none",
        "[&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:!bg-transparent",
      )}
      // eslint-disable-next-line react/no-danger -- shiki output is escaped HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
