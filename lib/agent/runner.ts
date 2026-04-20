import "server-only";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Find the absolute path of `bun` once. Windows spawn doesn't walk PATH for bare names. */
function resolveBunPath(): string {
  if (process.env.CLAUDE_CODE_EXECUTABLE) return process.env.CLAUDE_CODE_EXECUTABLE;
  try {
    const cmd = process.platform === "win32" ? "where.exe bun" : "which bun";
    const output = execSync(cmd, { encoding: "utf8" }).trim();
    const first = output.split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) return first;
  } catch {
    // fall through
  }
  return process.platform === "win32" ? "bun.exe" : "bun";
}
import { asc, eq, sql as dsql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@/lib/db/client";
import { sessionMessages, sessions } from "@/lib/db/schema";
import { recordArtifact } from "@/lib/db/artifacts";

const execFileAsync = promisify(execFile);

/**
 * Locate the Claude Code CLI at runtime. The SDK spawns this as a subprocess.
 * We build the path as a plain string so the Next.js bundler doesn't try to
 * trace it (the package is ESM and can't be statically required).
 */
function resolveClaudeCodePath(): string | undefined {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  const candidates = [
    path.join(
      process.cwd(),
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "cli.js",
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

import type {
  MessageKind,
  StreamEvent,
} from "@/lib/agent/runner-events";

export type {
  StreamEvent,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from "@/lib/agent/runner-events";

type Listener = (e: StreamEvent) => void;

interface RunnerState {
  listeners: Set<Listener>;
  running: boolean;
}

/**
 * In-memory registry of active session runners, keyed by sessionId.
 * Survives across requests within one Node process. For multi-process
 * deploys we'll have to promote this to a queue; fine for single-node.
 */
const registry: Map<string, RunnerState> = (() => {
  const g = globalThis as unknown as {
    __jupietreRunners?: Map<string, RunnerState>;
  };
  if (!g.__jupietreRunners) g.__jupietreRunners = new Map();
  return g.__jupietreRunners;
})();

function getState(sessionId: string): RunnerState {
  let s = registry.get(sessionId);
  if (!s) {
    s = { listeners: new Set(), running: false };
    registry.set(sessionId, s);
  }
  return s;
}

export function subscribe(sessionId: string, listener: Listener): () => void {
  const state = getState(sessionId);
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

function emit(sessionId: string, event: StreamEvent) {
  const state = getState(sessionId);
  for (const l of state.listeners) {
    try {
      l(event);
    } catch {
      // ignore listener errors
    }
  }
}

async function nextMessageIndex(sessionId: string): Promise<number> {
  const rows = await db
    .select({ count: dsql<number>`count(*)::int` })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId));
  return rows[0]?.count ?? 0;
}

async function persistMessage(
  sessionId: string,
  kind: MessageKind,
  text: string,
  raw?: unknown,
): Promise<{ id: string; createdAt: string; indexInSession: number }> {
  const id = nanoid();
  const createdAt = new Date();
  const indexInSession = await nextMessageIndex(sessionId);
  await db.insert(sessionMessages).values({
    id,
    sessionId,
    indexInSession,
    kind,
    text,
    raw: (raw ?? null) as unknown as object | null,
  });
  const createdAtIso = createdAt.toISOString();
  emit(sessionId, {
    type: "message",
    message: { id, kind, text, createdAt: createdAtIso, indexInSession },
  });
  return { id, createdAt: createdAtIso, indexInSession };
}

/**
 * Build a transcript of the messages copied into a forked session, formatted
 * for replay as a prompt prefix on the first turn after a fork.
 *
 * Excludes the user message that the runner just persisted (the "new" prompt),
 * keyed by indexInSession <= forkedAtMessageIndex.
 */
async function buildForkTranscript(
  sessionId: string,
  forkedAtMessageIndex: number | null,
): Promise<string | null> {
  if (forkedAtMessageIndex === null) return null;
  const rows = await db
    .select({
      indexInSession: sessionMessages.indexInSession,
      kind: sessionMessages.kind,
      text: sessionMessages.text,
    })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(asc(sessionMessages.indexInSession));
  const copied = rows.filter(
    (r) => r.indexInSession <= forkedAtMessageIndex && r.kind !== "system",
  );
  if (copied.length === 0) return null;
  const lines = copied.map((r) => {
    const speaker =
      r.kind === "user" ? "User" : r.kind === "assistant" ? "Assistant" : "Tool";
    return `[${speaker}]: ${r.text}`;
  });
  return [
    "Below is the conversation that led up to this point. It happened in a sibling session you've been forked from. Continue from where it left off — do not re-introduce yourself or repeat earlier work.",
    "",
    "--- transcript ---",
    ...lines,
    "--- end transcript ---",
    "",
    "The user has now sent the next prompt:",
  ].join("\n");
}

async function setStatus(
  sessionId: string,
  status: "idle" | "running" | "error",
): Promise<void> {
  await db
    .update(sessions)
    .set({ status, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
  emit(sessionId, { type: "status", status });
}

/**
 * Extract a displayable text string from an SDK message payload.
 * Returns null when the message has nothing worth showing.
 */
function extractDisplay(message: unknown): {
  kind: MessageKind;
  text: string;
} | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as { type?: string; subtype?: string; message?: unknown };

  if (m.type === "assistant") {
    const inner = m.message as { content?: unknown } | undefined;
    const content = Array.isArray(inner?.content) ? inner.content : [];
    const textParts: string[] = [];
    const toolParts: string[] = [];
    for (const block of content as Array<{
      type?: string;
      text?: string;
      name?: string;
    }>) {
      if (block.type === "text" && block.text) textParts.push(block.text);
      else if (block.type === "tool_use" && block.name)
        toolParts.push(block.name);
    }
    // Assistant said something — show the text. Tool calls from the same
    // turn are recorded separately (kind="tool") so the UI can group them.
    if (textParts.length > 0) {
      return { kind: "assistant", text: textParts.join("\n") };
    }
    // Pure tool turn — record just the tool names, comma-joined. The UI
    // collapses consecutive tool messages into one activity strip.
    if (toolParts.length > 0) {
      return { kind: "tool", text: toolParts.join(",") };
    }
    return null;
  }

  // Tool results (user messages from the SDK) and noisy system events
  // (init, task_progress, task_started, task_notification) carry no info
  // a human reviewer wants to see — drop them. Real errors are persisted
  // separately by the result handler.
  return null;
}

/**
 * Look at an assistant message's tool_use blocks and record a `file_change`
 * artifact for each unique path touched by Write/Edit (and NotebookEdit).
 * Deduped on (sessionId, kind, file_path) via the artifact unique index.
 *
 * `turnIndex` is the indexInSession of the assistant message that emitted
 * these tool calls (when persisted) — stored in `raw` so the code-review
 * panel can attribute hunks back to the assistant turn that wrote them.
 */
async function captureFileChangeArtifacts(
  sessionId: string,
  message: unknown,
  turnIndex: number | null,
): Promise<void> {
  if (typeof message !== "object" || message === null) return;
  const m = message as { type?: string; message?: unknown };
  if (m.type !== "assistant") return;
  const inner = m.message as { content?: unknown } | undefined;
  const content = Array.isArray(inner?.content) ? inner.content : [];
  for (const block of content as Array<{
    type?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>) {
    if (block.type !== "tool_use") continue;
    if (!block.name || !block.input) continue;
    if (
      block.name === "Write" ||
      block.name === "Edit" ||
      block.name === "NotebookEdit"
    ) {
      const fp = (block.input.file_path ?? block.input.path) as
        | string
        | undefined;
      if (!fp) continue;
      try {
        await recordArtifact({
          sessionId,
          kind: "file_change",
          title: fp,
          externalId: fp,
          summary: block.name,
          raw: {
            tool: block.name,
            input: block.input,
            indexInSession: turnIndex,
          },
        });
      } catch (err) {
        console.warn("[runner] file_change artifact failed:", err);
      }
    }
  }
}

async function captureCommitArtifacts(
  sessionId: string,
  repoPath: string,
  baseSha: string,
): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        `${baseSha}..HEAD`,
        "--pretty=format:%H%x1f%s%x1f%an%x1f%aI",
      ],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 },
    );
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const [sha, subject, author, iso] = line.split("\x1f");
      if (!sha || !subject) continue;
      await recordArtifact({
        sessionId,
        kind: "commit",
        title: subject,
        externalId: sha,
        summary: `${author ?? "unknown"} · ${iso ?? ""}`.trim(),
        raw: { sha, author, iso },
      });
    }
  } catch (err) {
    console.warn("[runner] commit artifact capture failed:", err);
  }
}

/**
 * Start an agent turn. Spawns `query()` in the background, streams messages
 * through SSE listeners, and persists everything.
 *
 * - If the session already has an sdkSessionId, the SDK resumes that session.
 * - On completion, status returns to "idle" so the user can send another msg.
 */
export async function startTurn(params: {
  sessionId: string;
  userText: string;
}): Promise<void> {
  const { sessionId, userText } = params;
  const state = getState(sessionId);
  if (state.running) return;
  state.running = true;

  // persist user message first
  await persistMessage(sessionId, "user", userText);
  await setStatus(sessionId, "running");

  // lazy-import SDK + role so Next.js doesn't try to include it in client bundles
  void (async () => {
    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      const { getAgentConfig } = await import("@/lib/db/agent-configs");
      const { buildSdkOptionsFromConfig } = await import(
        "@/lib/agent/load-agent-config"
      );
      const { buildMcpServersForSession } = await import(
        "@/lib/agent/mcp-tools"
      );
      const row = (
        await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
      )[0];
      if (!row) throw new Error("Session missing");

      const config = await getAgentConfig(row.userId, row.agentConfigId);
      if (!config) {
        throw new Error(
          `No agent config found for session ${sessionId} (agentConfigId=${row.agentConfigId})`,
        );
      }

      // Budget kill-switch: refuse new turns when the agent's daily/monthly
      // cap is already exceeded. Per-session cap is enforced by the SDK.
      const { canStartSession } = await import("@/lib/agent/budget");
      const budget = await canStartSession(config);
      if (!budget.allowed) {
        await persistMessage(
          sessionId,
          "system",
          `Budget cap reached: ${budget.reason ?? "blocked"}`,
        );
        await setStatus(sessionId, "error");
        state.running = false;
        return;
      }

      // M9: every new session has its own worktree under DATA_DIR. Legacy
      // rows (pre-M9) fall back to repoPath so they keep working unchanged.
      const cwd = row.worktreePath ?? row.repoPath;

      // Capture baseSha on the very first turn so we can diff at finish time.
      let baseSha = row.baseSha ?? null;
      if (!baseSha) {
        try {
          const { stdout } = await execFileAsync(
            "git",
            ["rev-parse", "HEAD"],
            { cwd },
          );
          baseSha = stdout.trim();
          await db
            .update(sessions)
            .set({ baseSha })
            .where(eq(sessions.id, sessionId));
        } catch (err) {
          console.warn(
            `[runner] could not capture baseSha for ${sessionId}:`,
            err,
          );
        }
      }

      const claudePath = resolveClaudeCodePath();
      const bunPath = resolveBunPath();
      console.log(
        `[runner] spawning agent: executable=${bunPath} cli=${claudePath ?? "(default)"} cwd=${cwd} agent=${config.name}`,
      );
      const built = buildSdkOptionsFromConfig(config, cwd);
      const options: Record<string, unknown> = {
        ...built,
        executable: bunPath,
        stderr: (chunk: string) => {
          process.stderr.write(`[agent-stderr] ${chunk}`);
        },
      };
      if (claudePath) options.pathToClaudeCodeExecutable = claudePath;
      if (row.sdkSessionId) options.resume = row.sdkSessionId;

      const mcpServers = buildMcpServersForSession({
        sessionId,
        repoPath: cwd,
        agent: config,
      });
      if (mcpServers) options.mcpServers = mcpServers;

      if (config.approvalMode !== "none") {
        const { makeCanUseTool } = await import("@/lib/agent/can-use-tool");
        options.canUseTool = makeCanUseTool({
          sessionId,
          mode: config.approvalMode,
          gatedTools: config.approvalTools ?? [],
          timeoutSeconds: config.approvalTimeoutSeconds,
          emit,
          persistMessage,
        });
      }

      // First turn after a fork: no SDK session yet, but the new session has
      // copied transcript from its parent. Replay it as a prefix so the agent
      // sees the conversation that led up to the fork point.
      let promptText = userText;
      if (!row.sdkSessionId && row.parentSessionId) {
        const transcript = await buildForkTranscript(
          sessionId,
          row.forkedAtMessageIndex,
        );
        if (transcript) promptText = `${transcript}\n\n${userText}`;
      }

      const session = query({
        prompt: promptText,
        options: options as Parameters<typeof query>[0]["options"],
      });

      for await (const message of session as AsyncIterable<unknown>) {
        const m = message as {
          type?: string;
          subtype?: string;
          session_id?: string;
          total_cost_usd?: number;
          result?: string;
          errors?: string[];
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
        };

        // capture sdk session id from init
        if (m.type === "system" && m.subtype === "init" && m.session_id) {
          await db
            .update(sessions)
            .set({ sdkSessionId: m.session_id })
            .where(eq(sessions.id, sessionId));
        }

        if (m.type === "result") {
          // Only persist on error — success `result` is a restatement of the
          // final assistant message we already streamed.
          if (m.subtype !== "success") {
            const errText = `Error: ${m.errors?.join("; ") ?? m.subtype}`;
            await persistMessage(sessionId, "system", errText, m);
          }
          if (typeof m.total_cost_usd === "number") {
            const prevCumulative = Number.parseFloat(row.totalCostUsd ?? "0");
            const deltaUsd = Math.max(
              0,
              m.total_cost_usd - (Number.isFinite(prevCumulative) ? prevCumulative : 0),
            );
            if (deltaUsd > 0) {
              const { recordUsage, usdToMicro } = await import(
                "@/lib/db/usage"
              );
              await recordUsage({
                userId: row.ownerId ?? row.userId,
                sessionId,
                agentConfigId: config.id,
                teamId: row.teamId,
                model: config.model,
                inputTokens: m.usage?.input_tokens ?? 0,
                outputTokens: m.usage?.output_tokens ?? 0,
                cachedInputTokens:
                  (m.usage?.cache_read_input_tokens ?? 0) +
                  (m.usage?.cache_creation_input_tokens ?? 0),
                costMicroUsd: usdToMicro(deltaUsd),
              }).catch((err) => {
                console.warn("[runner] recordUsage failed:", err);
              });
            }
            await db
              .update(sessions)
              .set({
                totalCostUsd: String(m.total_cost_usd),
              })
              .where(eq(sessions.id, sessionId));
            // Keep local `row` in sync so multi-result-in-one-stream deltas don't double-count.
            row.totalCostUsd = String(m.total_cost_usd);
          }
          continue;
        }

        // Persist the assistant message first so we can attribute the
        // file-change artifacts to the same indexInSession.
        const display = extractDisplay(message);
        let turnIndex: number | null = null;
        if (display) {
          const persisted = await persistMessage(
            sessionId,
            display.kind,
            display.text,
            message,
          );
          turnIndex = persisted.indexInSession;
        }
        await captureFileChangeArtifacts(sessionId, message, turnIndex);
      }

      // Emit commit artifacts for anything landed since baseSha.
      if (baseSha) {
        await captureCommitArtifacts(sessionId, cwd, baseSha);
      }

      await setStatus(sessionId, "idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await persistMessage(sessionId, "system", `Runner error: ${msg}`);
      await setStatus(sessionId, "error");
    } finally {
      state.running = false;

      // Drain any /btw follow-ups that arrived while we were running. We
      // do this AFTER releasing state.running so the recursive startTurn
      // can re-acquire it cleanly.
      try {
        const pending = await drainPendingUserText(sessionId);
        if (pending) {
          // Fire-and-forget so the original promise can settle.
          void startTurn({ sessionId, userText: pending });
        }
      } catch (drainErr) {
        console.warn(
          `[runner] failed to drain pending follow-ups for ${sessionId}:`,
          drainErr,
        );
      }
    }
  })();
}

/**
 * Append a "/btw"-style follow-up while the agent is mid-turn. Persists the
 * message immediately as a user bubble (so the operator sees it land in the
 * transcript) and stores it on the session row for the runner to drain at
 * end-of-turn. Multiple follow-ups join with a blank line.
 */
export async function queueFollowUp(params: {
  sessionId: string;
  userText: string;
}): Promise<void> {
  const { sessionId, userText } = params;
  await persistMessage(sessionId, "user", userText, { queued: true });
  await db
    .update(sessions)
    .set({
      pendingUserText: dsql`COALESCE(${sessions.pendingUserText} || E'\n\n', '') || ${userText}`,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
}

/**
 * Atomically read and clear `pendingUserText`. Uses a CTE so the read of the
 * old value and the clear of the column happen as a single statement — two
 * concurrent end-of-turn drains can't both swallow the same queued message.
 */
async function drainPendingUserText(sessionId: string): Promise<string | null> {
  const result = await db.execute<{ pending_user_text: string | null }>(
    dsql`
      WITH old AS (
        SELECT pending_user_text FROM sessions WHERE id = ${sessionId} FOR UPDATE
      ),
      cleared AS (
        UPDATE sessions
        SET pending_user_text = NULL, updated_at = NOW()
        WHERE id = ${sessionId} AND pending_user_text IS NOT NULL
        RETURNING id
      )
      SELECT pending_user_text FROM old
    `,
  );
  // drizzle's execute() returns either { rows: [...] } (postgres-js / pg)
  // or the array directly depending on the driver. Handle both.
  const rows = Array.isArray(result)
    ? (result as unknown as Array<{ pending_user_text: string | null }>)
    : ((result as { rows?: Array<{ pending_user_text: string | null }> }).rows ?? []);
  return rows[0]?.pending_user_text ?? null;
}
