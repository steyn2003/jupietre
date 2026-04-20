"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PaperPlaneTiltIcon,
  GitBranchIcon,
  WarningIcon,
  CheckIcon,
  XIcon,
  ArrowDownIcon,
  RowsIcon,
  RowsPlusTopIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { Markdown } from "@/components/chat/Markdown";
import { useAutoGrow } from "@/components/chat/useAutoGrow";
import { useStickToBottom } from "@/components/chat/useStickToBottom";
import { useDensity, type Density } from "@/components/chat/useDensity";
import { useRelativeTime } from "@/components/chat/useRelativeTime";
import { DiffPanel } from "./diff-panel";
import { ResultsPanel } from "./results-panel";

type Msg = {
  id: string;
  kind: "user" | "assistant" | "system" | "tool";
  text: string;
  createdAt: string;
  indexInSession: number;
};

type Status = "idle" | "running" | "error";

type PendingApproval = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  timeoutSeconds: number;
  expiresAt: number;
};

export function SessionChat({
  sessionId,
  initialMessages,
  initialStatus,
  initialPendingApprovals = [],
}: {
  sessionId: string;
  initialMessages: Msg[];
  initialStatus: Status;
  initialPendingApprovals?: PendingApproval[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [forkingIndex, setForkingIndex] = useState<number | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>(
    initialPendingApprovals,
  );
  const [density, setDensity] = useDensity();

  // Scroller sticks to bottom while new messages arrive, *unless* the user
  // scrolled up — then we surface the jump-to-latest pill.
  const { ref: scrollerRef, atBottom, scrollToBottom } =
    useStickToBottom<HTMLDivElement>(messages.length);

  useEffect(() => {
    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    es.addEventListener("message", (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as
          | { type: "message"; message: Msg }
          | { type: "status"; status: Status }
          | {
              type: "approval-requested";
              approval: {
                id: string;
                toolName: string;
                args: Record<string, unknown>;
                timeoutSeconds: number;
                createdAt: string;
              };
            }
          | {
              type: "approval-resolved";
              approval: { id: string; status: "approved" | "denied" | "timeout" };
            };
        if (payload.type === "message") {
          setMessages((prev) =>
            prev.some((m) => m.id === payload.message.id)
              ? prev
              : [...prev, payload.message],
          );
        } else if (payload.type === "status") {
          setStatus(payload.status);
        } else if (payload.type === "approval-requested") {
          const a = payload.approval;
          setPendingApprovals((prev) =>
            prev.some((x) => x.id === a.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: a.id,
                    toolName: a.toolName,
                    args: a.args,
                    timeoutSeconds: a.timeoutSeconds,
                    expiresAt:
                      new Date(a.createdAt).getTime() + a.timeoutSeconds * 1000,
                  },
                ],
          );
        } else if (payload.type === "approval-resolved") {
          setPendingApprovals((prev) =>
            prev.filter((x) => x.id !== payload.approval.id),
          );
        }
      } catch {
        // ignore malformed event
      }
    });
    es.addEventListener("error", () => {
      // let the browser auto-reconnect
    });
    return () => es.close();
  }, [sessionId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending || status === "running") return;
    setSending(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input }),
      });
      if (res.ok) setInput("");
    } finally {
      setSending(false);
    }
  }

  async function handleFork(atMessageIndex: number) {
    if (forkingIndex !== null) return;
    setForkingIndex(atMessageIndex);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atMessageIndex }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(data?.error ?? `Failed to fork (${res.status})`);
        return;
      }
      const data = (await res.json()) as { id: string };
      router.push(`/sessions/${data.id}`);
    } finally {
      setForkingIndex(null);
    }
  }

  async function decideApproval(
    approvalId: string,
    decision: "approve" | "deny",
    reason?: string,
  ) {
    setPendingApprovals((prev) => prev.filter((x) => x.id !== approvalId));
    await fetch(`/api/approvals/${approvalId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    });
  }

  // The last assistant message is "live" while the agent is running — gets
  // the streaming caret tacked on instead of the separate typing indicator.
  const lastIdx = messages.length - 1;
  const lastMsg = lastIdx >= 0 ? messages[lastIdx] : null;
  const streamingLastAssistant =
    status === "running" && lastMsg?.kind === "assistant";
  const showTypingBelow = status === "running" && !streamingLastAssistant;

  const rowGap = density === "compact" ? "space-y-1" : "space-y-3";

  return (
    <div className="flex flex-col gap-3">
      <ResultsPanel sessionId={sessionId} running={status === "running"} />
      <DiffPanel sessionId={sessionId} running={status === "running"} />

      <DensityToolbar value={density} onChange={setDensity} />

      <div className="relative">
        <div
          ref={scrollerRef}
          className={cn(
            "flex-1 overflow-y-auto",
            "rounded-2xl ring-1 ring-hairline bg-surface-1/60 p-4",
            "min-h-[40dvh] max-h-[60dvh]",
            rowGap,
          )}
        >
          {messages.length === 0 ? (
            <p className="text-center text-[12px] text-fg-subtle py-12">
              No messages yet — say something below.
            </p>
          ) : null}
          {groupForDisplay(messages).map((item, i, items) => {
            if (item.kind === "activity") {
              return (
                <ActivityStrip
                  key={item.key}
                  toolNames={item.toolNames}
                  active={
                    status === "running" && i === items.length - 1
                  }
                />
              );
            }
            const m = item.msg;
            // Look back over the items array to find the previous bubble.
            let prevBubble: Msg | undefined;
            for (let j = i - 1; j >= 0; j--) {
              const p = items[j];
              if (p.kind === "msg") {
                prevBubble = p.msg;
                break;
              }
            }
            const groupedWithPrev =
              !!prevBubble && sameBubbleGroup(prevBubble, m);
            return (
              <MessageBubble
                key={m.id}
                msg={m}
                density={density}
                groupedWithPrev={groupedWithPrev}
                streaming={streamingLastAssistant && i === items.length - 1}
                onFork={
                  m.kind === "assistant"
                    ? () => handleFork(m.indexInSession)
                    : undefined
                }
                forking={forkingIndex === m.indexInSession}
              />
            );
          })}
          <AnimatePresence>
            {pendingApprovals.map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                onDecide={(decision, reason) =>
                  decideApproval(a.id, decision, reason)
                }
              />
            ))}
          </AnimatePresence>
          {showTypingBelow ? <TypingIndicator /> : null}
        </div>

        <AnimatePresence>
          {!atBottom ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10"
            >
              <button
                type="button"
                onClick={() => scrollToBottom()}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full h-8 px-3.5",
                  "bg-surface-2 ring-1 ring-hairline text-[12px] text-fg",
                  "backdrop-blur-xl shadow-[var(--shadow-soft)]",
                  "hover:bg-surface-3 transition-colors duration-150",
                )}
              >
                <ArrowDownIcon weight="bold" className="h-3 w-3" />
                Jump to latest
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={handleSend}
        disabled={false}
        sending={sending}
        running={status === "running"}
      />
    </div>
  );
}

/** Two messages group visually if they are same kind AND within 2 minutes. */
function sameBubbleGroup(a: Msg, b: Msg): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "system" || a.kind === "tool") return false;
  const dt = Math.abs(
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return dt < 2 * 60 * 1000;
}

type DisplayItem =
  | { kind: "msg"; msg: Msg }
  | { kind: "activity"; key: string; toolNames: string[] };

/**
 * Walk the message list and collapse consecutive `tool` messages into a
 * single ActivityStrip. Each tool message's text is the comma-joined list
 * of tool names emitted in that turn (see runner.ts extractDisplay) — we
 * flatten them here so the strip can show "Read · Bash · Edit" etc.
 *
 * `system` messages are also folded into the activity strip (they're
 * runtime status — operator-relevant errors only, since the noisy ones
 * are now dropped at persist time).
 */
function groupForDisplay(messages: Msg[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let buffer: { tools: string[]; firstId: string } | null = null;

  const flush = () => {
    if (buffer) {
      items.push({
        kind: "activity",
        key: `act-${buffer.firstId}`,
        toolNames: buffer.tools,
      });
      buffer = null;
    }
  };

  for (const m of messages) {
    if (m.kind === "tool") {
      const tools = m.text.split(",").map((s) => s.trim()).filter(Boolean);
      if (!buffer) buffer = { tools: [], firstId: m.id };
      buffer.tools.push(...tools);
    } else {
      flush();
      items.push({ kind: "msg", msg: m });
    }
  }
  flush();
  return items;
}

/**
 * Compact, single-line summary of a run of tool calls. Shows up to three
 * distinct tool names plus a "+N more" badge; expands on click for the
 * full ordered list.
 */
function ActivityStrip({
  toolNames,
  active,
}: {
  toolNames: string[];
  active?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (toolNames.length === 0) return null;

  const distinct = Array.from(new Set(toolNames));
  const preview = distinct.slice(0, 3);
  const extra = distinct.length - preview.length;

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => setExpanded((v) => !v)}
      className={cn(
        "group flex items-start gap-2 w-full text-left",
        "rounded-lg px-2.5 py-1.5",
        "text-[11px] text-fg-subtle",
        "hover:bg-surface-2/60 transition-colors duration-150",
      )}
      title={expanded ? "Collapse" : "Show all tool calls"}
    >
      <span
        className={cn(
          "mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0",
          active ? "bg-accent animate-pulse" : "bg-fg-subtle/40",
        )}
      />
      <span className="flex-1 min-w-0">
        {expanded ? (
          <span className="font-mono break-all leading-relaxed">
            {toolNames.join(" · ")}
          </span>
        ) : (
          <>
            <span className="font-mono">{preview.join(" · ")}</span>
            {extra > 0 ? (
              <span className="ml-1.5 text-fg-subtle/70">+{extra} more</span>
            ) : null}
            <span className="ml-2 tabular-nums text-fg-subtle/70">
              · {toolNames.length} call{toolNames.length === 1 ? "" : "s"}
            </span>
          </>
        )}
      </span>
    </motion.button>
  );
}

function DensityToolbar({
  value,
  onChange,
}: {
  value: Density;
  onChange: (d: Density) => void;
}) {
  return (
    <div className="flex justify-end">
      <div className="inline-flex rounded-full ring-1 ring-hairline bg-surface-1/60 p-0.5">
        {(
          [
            {
              key: "comfortable",
              label: "Comfortable",
              Icon: RowsPlusTopIcon,
            },
            { key: "compact", label: "Compact", Icon: RowsIcon },
          ] as const
        ).map(({ key, label, Icon }) => {
          const active = value === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={active}
              title={label}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px]",
                "transition-colors duration-150",
                active
                  ? "bg-surface-3 text-fg"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              <Icon weight="regular" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  sending,
  running,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
  sending: boolean;
  running?: boolean;
}) {
  const ref = useAutoGrow(value, { minRows: 1, maxRows: 8 });

  return (
    <div className="flex flex-col gap-1">
      {running ? (
        <div className="flex items-center gap-1.5 px-2 text-[11px] text-fg-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          <span>
            Agent is working — your message will be delivered as a follow-up the
            moment the current turn finishes.
          </span>
        </div>
      ) : null}
      <form
        onSubmit={onSubmit}
        className={cn(
          "flex items-end gap-2 rounded-2xl ring-1 bg-surface-1 p-2",
          "focus-within:ring-[color:var(--border-focus)] transition-shadow",
          running ? "ring-[color:var(--accent-soft)]" : "ring-hairline",
        )}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={1}
          placeholder={
            disabled
              ? "Wait for the agent to finish…"
              : running
                ? "Drop a follow-up — sent the moment the current turn ends"
                : "Reply to the agent — Enter sends, Shift+Enter for a newline"
          }
          disabled={disabled}
          className={cn(
            "flex-1 resize-none bg-transparent outline-none border-0",
            "px-2 py-2 text-[14px] leading-relaxed text-fg placeholder:text-fg-subtle",
            "disabled:opacity-50",
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e as unknown as React.FormEvent);
            }
          }}
        />
        <Button
          type="submit"
          size="sm"
          disabled={sending || disabled || !value.trim()}
          loading={sending}
          trailingIcon={
            <PaperPlaneTiltIcon weight="fill" className="h-3 w-3" />
          }
        >
          {running ? "Queue" : "Send"}
        </Button>
      </form>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-[12px] text-fg-muted px-2">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-accent"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              delay: i * 0.18,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
      Agent working
    </div>
  );
}

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: PendingApproval;
  onDecide: (decision: "approve" | "deny", reason?: string) => void;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((approval.expiresAt - Date.now()) / 1000)),
  );
  const [denyReason, setDenyReason] = useState("");
  const [showReason, setShowReason] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setRemaining(
        Math.max(0, Math.round((approval.expiresAt - Date.now()) / 1000)),
      );
    }, 1000);
    return () => clearInterval(t);
  }, [approval.expiresAt]);

  const formattedArgs = (() => {
    try {
      return JSON.stringify(approval.args, null, 2);
    } catch {
      return String(approval.args);
    }
  })();

  const pctRemaining = Math.min(
    100,
    Math.max(0, (remaining / approval.timeoutSeconds) * 100),
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      className="rounded-2xl ring-1 ring-[color:var(--warning-soft)] bg-warning-soft/40 overflow-hidden"
    >
      <div className="h-0.5 bg-warning/15">
        <motion.div
          className="h-full bg-warning"
          initial={false}
          animate={{ width: `${pctRemaining}%` }}
          transition={{ duration: 0.5, ease: "linear" }}
        />
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] font-medium text-warning">
            <WarningIcon weight="fill" className="h-4 w-4" />
            <span className="uppercase tracking-[0.08em]">Approval needed</span>
            <span className="font-mono normal-case text-fg">
              {approval.toolName}
            </span>
          </div>
          <div className="text-[11px] text-fg-muted tabular-nums font-mono">
            {remaining > 0 ? `auto-deny in ${remaining}s` : "expired"}
          </div>
        </div>
        <pre className="max-h-48 overflow-auto rounded-lg bg-bg/60 ring-1 ring-hairline p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-fg-muted">
          {formattedArgs}
        </pre>
        {showReason ? (
          <Input
            type="text"
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder="Optional reason for denial"
            className="text-[12px] h-9"
          />
        ) : null}
        <div className="flex justify-end gap-2">
          {!showReason ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowReason(true)}
            >
              Deny with reason…
            </Button>
          ) : null}
          <Button
            type="button"
            variant="danger"
            size="sm"
            leadingIcon={<XIcon weight="bold" className="h-3.5 w-3.5" />}
            onClick={() => onDecide("deny", denyReason || undefined)}
          >
            Deny
          </Button>
          <Button
            type="button"
            size="sm"
            leadingIcon={<CheckIcon weight="bold" className="h-3.5 w-3.5" />}
            onClick={() => onDecide("approve")}
          >
            Approve
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function MessageBubble({
  msg,
  density,
  groupedWithPrev,
  streaming,
  onFork,
  forking,
}: {
  msg: Msg;
  density: Density;
  groupedWithPrev: boolean;
  streaming?: boolean;
  onFork?: () => void;
  forking?: boolean;
}) {
  const time = useRelativeTime(msg.createdAt);

  if (msg.kind === "tool") {
    return (
      <div className="text-[11px] text-fg-subtle italic font-mono px-2">
        {msg.text}
      </div>
    );
  }

  if (msg.kind === "system") {
    return (
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="h-px flex-1 bg-hairline" />
        <Badge size="sm">{msg.text}</Badge>
        <span className="h-px flex-1 bg-hairline" />
      </div>
    );
  }

  // Tighten spacing when this bubble is the same sender as the previous
  // bubble AND within 2 minutes — visual grouping, no repeated tail.
  const tightTop = groupedWithPrev ? "-mt-1.5" : "";
  const bubblePad = density === "compact" ? "px-3 py-1.5" : "px-4 py-2.5";

  if (msg.kind === "user") {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className={cn("group/msg flex justify-end", tightTop)}
      >
        <div className="relative max-w-[80%] flex flex-col items-end gap-1">
          <div
            className={cn(
              "rounded-2xl bg-accent text-accent-fg whitespace-pre-wrap shadow-[var(--shadow-soft)]",
              "text-[14px]",
              bubblePad,
              groupedWithPrev ? "rounded-br-md" : "rounded-br-md",
            )}
          >
            {msg.text}
          </div>
          <span className="text-[10px] font-mono text-fg-subtle opacity-0 group-hover/msg:opacity-100 transition-opacity px-1">
            {time}
          </span>
        </div>
      </motion.div>
    );
  }

  // assistant
  return (
    <motion.div
      id={`msg-${msg.indexInSession}`}
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className={cn("group/msg flex justify-start scroll-mt-4", tightTop)}
    >
      <div className="relative max-w-[85%] flex flex-col items-start gap-1">
        <div
          className={cn(
            "rounded-2xl rounded-bl-md ring-1 ring-hairline bg-surface-2 text-fg",
            bubblePad,
          )}
        >
          {msg.text ? (
            <Markdown>{msg.text}</Markdown>
          ) : (
            <span className="inline-block h-[1em] w-[0.5em] bg-fg-muted align-middle animate-[caret-blink_1s_step-end_infinite]" />
          )}
          {streaming && msg.text ? (
            <span className="inline-block h-[1em] w-[0.5em] translate-y-[2px] ml-0.5 bg-accent align-middle animate-[caret-blink_1s_step-end_infinite]" />
          ) : null}
        </div>
        <span className="text-[10px] font-mono text-fg-subtle opacity-0 group-hover/msg:opacity-100 transition-opacity px-1">
          {time}
        </span>
        {onFork ? (
          <div className="absolute -right-2 -top-2 opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100">
            <IconButton
              variant="surface"
              size="sm"
              aria-label={`Fork from turn ${msg.indexInSession}`}
              onClick={onFork}
              disabled={forking}
              title={`Fork from turn ${msg.indexInSession}`}
            >
              <GitBranchIcon weight="regular" />
            </IconButton>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
