import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { sessionMessages, sessions, users } from "@/lib/db/schema";
import {
  getAgentConfigById,
  listAgentConfigs,
  type AgentConfig,
} from "@/lib/db/agent-configs";
import {
  listEnabledPollersWithRules,
  type LinearPoller,
  type LinearPollerRule,
  type PollerWithRules,
} from "@/lib/db/linear-pollers";
import { listAllRepos, type Repo } from "@/lib/repos/manager";
import { provisionWorktree } from "@/lib/worktrees/manager";
import { startTurn } from "@/lib/agent/runner";
import { defaultWorkflowForRule } from "./default-workflows";
import { seedFromEnvIfEmpty } from "./seed-from-env";

interface ResolvedRule {
  rule: LinearPollerRule;
  agent: AgentConfig;
  /** poller.defaultLabel unless rule.labelOverride is set */
  effectiveLabel: string;
}

/**
 * If other agents have previously worked on this Linear ticket, return a short
 * "Prior agent activity" block describing who, when, and the tail of their
 * final assistant message. This is prepended to the firstMessage so the new
 * agent can spot the handoff context immediately rather than scanning all
 * comments to figure out what's already happened.
 */
async function buildPriorContext(
  linearIssueId: string,
  currentAgentId: string,
): Promise<string | null> {
  const priorSessions = await db
    .select({
      id: sessions.id,
      agentConfigId: sessions.agentConfigId,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(eq(sessions.linearIssueId, linearIssueId))
    .orderBy(desc(sessions.createdAt))
    .limit(5);

  // Filter out any session belonging to the current agent — we want context
  // from OTHER agents (or our own past failed runs), not a self-reference.
  const others = priorSessions.filter((s) => s.agentConfigId !== currentAgentId);
  if (others.length === 0) return null;

  const userId = await findAdminUserId();
  if (!userId) return null;
  const allAgents = await listAgentConfigs(userId);
  const agentNameById = new Map(allAgents.map((a) => [a.id, a.name]));

  const lines: string[] = ["## Prior agent activity on this ticket"];
  for (const s of others.slice(0, 3)) {
    const name = agentNameById.get(s.agentConfigId) ?? "Unknown agent";
    const when = s.createdAt.toISOString().slice(0, 16).replace("T", " ");
    const lastMsg = (
      await db
        .select({ text: sessionMessages.text })
        .from(sessionMessages)
        .where(
          and(
            eq(sessionMessages.sessionId, s.id),
            eq(sessionMessages.kind, "assistant"),
          ),
        )
        .orderBy(desc(sessionMessages.indexInSession))
        .limit(1)
    )[0];
    const tail = lastMsg?.text
      ? lastMsg.text.length > 400
        ? lastMsg.text.slice(0, 400) + "…"
        : lastMsg.text
      : "(no assistant output recorded)";
    lines.push(`\n### ${name} — ${when} UTC\n${tail}`);
  }
  lines.push(
    "\n*Note: full handoff lives in the Linear comments (look for ⬆️ ➡️ ❌ ✅ markers in the latest comments). Always linear_get_issue first to read the canonical state.*",
  );
  return lines.join("\n");
}

async function buildRepoMap(): Promise<Map<string, Repo>> {
  const map = new Map<string, Repo>();
  const all = await listAllRepos();
  for (const r of all) map.set(r.slug.toLowerCase(), r);
  return map;
}

async function findAdminUserId(): Promise<string | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(users.createdAt)
    .limit(1);
  return rows[0]?.id ?? null;
}

async function resolveRules(
  poller: LinearPoller,
  rules: LinearPollerRule[],
): Promise<ResolvedRule[]> {
  const out: ResolvedRule[] = [];
  for (const rule of rules) {
    const agent = await getAgentConfigById(rule.agentConfigId);
    if (!agent) {
      console.warn(
        `[linear:${poller.name}] rule ${rule.id} references missing agent ${rule.agentConfigId} — skipping`,
      );
      continue;
    }
    out.push({
      rule,
      agent,
      effectiveLabel: rule.labelOverride ?? poller.defaultLabel,
    });
  }
  return out;
}

async function pollOnce(entry: PollerWithRules): Promise<void> {
  const { poller, rules } = entry;
  if (!poller.enabled) return;
  if (rules.length === 0) return;

  const { LinearClient } = await import("@linear/sdk");
  const client = new LinearClient({ apiKey: poller.apiKey });

  const userId = await findAdminUserId();
  if (!userId) return;

  const resolved = await resolveRules(poller, rules);
  if (resolved.length === 0) return;

  const repoMap = await buildRepoMap();

  for (const cfg of resolved) {
    const isTriage = cfg.rule.mode === "triage";
    // Triage: scan the state with no label filter — the whole point is the
    // agent gets to see every ticket and decide. Pickup: classic state +
    // label filter.
    const filter: Record<string, unknown> = {
      state: { name: { eqIgnoreCase: cfg.rule.pickupState } },
    };
    if (!isTriage) {
      filter.labels = {
        some: { name: { eqIgnoreCase: cfg.effectiveLabel } },
      };
    }
    if (poller.teamKey) {
      filter.team = { key: { eq: poller.teamKey } };
    }
    const issues = await client.issues({ filter });

    // Triage skips anything carrying the poller's defaultLabel (those belong
    // to pickup rules) or "needs-human" (already flagged for human review by
    // a previous triage run — re-triaging would loop).
    const triageSkipLabels = new Set([
      poller.defaultLabel.toLowerCase(),
      "needs-human",
    ]);

    for (const issue of issues.nodes) {
      // Gate per-(issue, agent), not per-issue. The same Linear ticket flows
      // through multiple agents (e.g. PM → Engineer → QA), and may re-enter an
      // earlier stage on rework. Each pickup gets its own session, but we MUST
      // avoid double-pickups while a session for this (issue, agent) is live.

      // (a) If ANY session for this issue is currently running, skip — we
      //     don't want two agents racing on the same ticket simultaneously.
      const liveOnAnyAgent = (
        await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.linearIssueId, issue.identifier),
              eq(sessions.status, "running"),
            ),
          )
          .limit(1)
      )[0];
      if (liveOnAnyAgent) continue;

      // (b) Per-agent cooldown — for pickup, prevents looping when Linear
      //     hasn't yet propagated our state move; for triage, prevents the
      //     same agent re-triaging immediately after a failed run that
      //     didn't change labels/state.
      const lastForThisAgent = (
        await db
          .select({
            id: sessions.id,
            status: sessions.status,
            createdAt: sessions.createdAt,
          })
          .from(sessions)
          .where(
            and(
              eq(sessions.linearIssueId, issue.identifier),
              eq(sessions.agentConfigId, cfg.agent.id),
            ),
          )
          .orderBy(desc(sessions.createdAt))
          .limit(1)
      )[0];
      if (lastForThisAgent) {
        const COOLDOWN_MS = 5 * 60 * 1000;
        const ageMs = Date.now() - lastForThisAgent.createdAt.getTime();
        if (ageMs < COOLDOWN_MS) continue;
      }

      const issueLabels = (await issue.labels()).nodes.map((l) =>
        l.name.toLowerCase(),
      );

      // Triage exclusion set — handled at the in-memory step because the
      // Linear `issues` filter API does not support a "labels NOT IN" form.
      if (
        isTriage &&
        issueLabels.some((l) => triageSkipLabels.has(l))
      ) {
        continue;
      }

      let repo: Repo | undefined;
      for (const lbl of issueLabels) {
        const r = repoMap.get(lbl);
        if (r) {
          repo = r;
          break;
        }
      }
      if (!repo && !isTriage) {
        // Pickup: a repo label is required because the agent will check out a
        // worktree and ship code. Skip and move on.
        console.warn(
          `[linear:${poller.name}] ${issue.identifier} has no label matching a registered repo (slugs: ${Array.from(
            repoMap.keys(),
          ).join(", ") || "(none)"}) — skipping`,
        );
        continue;
      }
      // Triage: a repo label is OPTIONAL. The triage agent reads broadly and
      // typically decides which repo to apply via a label. If we found one,
      // use it as the cwd; otherwise fall back to the registered-repos parent
      // dir so Read/Grep still resolve.
      let repoPath: string;
      let repoLabel: string;
      let repoId: string | null;
      if (repo) {
        repoPath = repo.clonePath;
        repoLabel = repo.slug;
        repoId = repo.id;
      } else {
        const path = await import("node:path");
        const anyRepo = Array.from(repoMap.values())[0];
        // No registered repos at all → triage agent has nothing to inspect.
        if (!anyRepo) {
          console.warn(
            `[linear:${poller.name}] no registered repos — triage of ${issue.identifier} skipped`,
          );
          continue;
        }
        repoPath = path.dirname(anyRepo.clonePath);
        repoLabel = "(triage)";
        repoId = null;
      }

      // Pickup auto-transitions to the in-progress state. Triage doesn't —
      // the agent decides where to move the ticket.
      if (!isTriage && cfg.rule.inProgressState) {
        try {
          const team = await issue.team;
          if (team) {
            const states = await team.states();
            const target = states.nodes.find(
              (s) =>
                s.name.toLowerCase() ===
                cfg.rule.inProgressState!.toLowerCase(),
            );
            if (target) {
              await client.updateIssue(issue.id, { stateId: target.id });
            }
          }
        } catch (err) {
          console.error(
            `[linear:${poller.name}] Failed to move ${issue.identifier} to ${cfg.rule.inProgressState}:`,
            err,
          );
        }
      }

      const sessionId = nanoid();
      const title = `${issue.identifier}: ${issue.title}`;
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        ownerId: userId,
        agentConfigId: cfg.agent.id,
        title,
        repoLabel,
        repoPath,
        repoId,
        source: "linear",
        linearIssueId: issue.identifier,
        linearPollerId: poller.id,
        status: "idle",
      });

      // Pickup spawns a worktree because the agent will commit + push.
      // Triage doesn't write code — it reads, labels, transitions. No
      // worktree saves provisioning time and disk churn.
      if (!isTriage && repo) {
        try {
          const wt = await provisionWorktree({
            sourceRepoPath: repoPath,
            sessionId,
            baseBranch: repo.defaultBranch,
          });
          await db
            .update(sessions)
            .set({
              worktreePath: wt.worktreePath,
              worktreeBranch: wt.worktreeBranch,
              baseSha: wt.baseSha,
              baseBranch: repo.defaultBranch,
            })
            .where(eq(sessions.id, sessionId));
        } catch (err) {
          console.warn(
            `[linear:${poller.name}] worktree provisioning failed for ${issue.identifier}; running against clone:`,
            err,
          );
        }
      }

      const workflow =
        cfg.rule.workflowTemplate ??
        defaultWorkflowForRule(cfg.rule.mode, cfg.agent.slug);
      const priorContext = await buildPriorContext(
        issue.identifier,
        cfg.agent.id,
      );
      // Triage mode: surface the registered-repo catalogue so the agent can
      // pick the right repo label, even when none is on the ticket yet.
      const repoCatalogue = isTriage
        ? `\nRegistered repos (apply one of these slugs as a label when triage outcome is "make pickup-eligible"):\n${
            Array.from(repoMap.values())
              .map((r) => `  - ${r.slug}  (${r.githubRepo})`)
              .join("\n") || "  (none registered)"
          }\n\nDefault pickup label: \`${poller.defaultLabel}\` — apply this in addition to the repo label.\n`
        : "";

      const firstMessage =
        `Linear ticket ${issue.identifier}: ${issue.title}\n\n` +
        `Description:\n${issue.description ?? "(no description)"}\n\n` +
        `Repo working directory: ${repoPath}\n` +
        repoCatalogue +
        "\n" +
        (priorContext ? priorContext + "\n\n" : "") +
        workflow +
        `\n\nThis ticket was triggered from the Linear poller. All progress, ` +
        `findings, and questions MUST be pushed back to Linear via the ` +
        `linear_* tools — not posted only in chat. The chat is for the ` +
        `operator to observe; Linear is the source of truth for the ticket.`;

      console.log(
        `[linear:${poller.name}] ${cfg.rule.mode === "triage" ? "Triage" : "Pickup"} session for ${issue.identifier} (${cfg.agent.slug}) in ${repoLabel}`,
      );
      void startTurn({ sessionId, userText: firstMessage });
    }
  }
}

// ─── manager: one tick loop per enabled poller, reconciled periodically ──

// Source of truth for what the ticks see. Reconcile rewrites this from DB.
// Each tick reads from here, so rule edits and renames propagate on the next
// tick without needing to restart the loop.
const ENTRIES: Map<string, PollerWithRules> = new Map();

interface RunningLoop {
  pollerId: string;
  intervalMs: number;
  timer: NodeJS.Timeout;
}

const RUNNING: Map<string, RunningLoop> = new Map();
const RECONCILE_INTERVAL_MS = 60_000;
let started = false;
let reconcileTimer: NodeJS.Timeout | null = null;

function startLoopFor(pollerId: string, intervalMs: number): void {
  const tick = () => {
    const entry = ENTRIES.get(pollerId);
    if (!entry) return;
    void pollOnce(entry).catch((err) => {
      console.error(`[linear:${entry.poller.name}] poll error:`, err);
    });
  };
  // First tick after a small delay so DB connections settle on boot.
  setTimeout(tick, 5_000);
  const timer = setInterval(tick, intervalMs);
  RUNNING.set(pollerId, { pollerId, intervalMs, timer });
  const name = ENTRIES.get(pollerId)?.poller.name ?? pollerId;
  const ruleCount = ENTRIES.get(pollerId)?.rules.length ?? 0;
  console.log(
    `[linear:${name}] loop started — every ${intervalMs / 1000}s, ${ruleCount} rule(s)`,
  );
}

function stopLoopFor(pollerId: string, name?: string): void {
  const running = RUNNING.get(pollerId);
  if (!running) return;
  clearInterval(running.timer);
  RUNNING.delete(pollerId);
  console.log(`[linear:${name ?? pollerId}] loop stopped`);
}

async function reconcile(): Promise<void> {
  const entries = await listEnabledPollersWithRules();
  const wantById = new Map(entries.map((e) => [e.poller.id, e]));

  // Stop loops for pollers that disappeared or were disabled.
  for (const id of [...RUNNING.keys()]) {
    if (!wantById.has(id)) {
      stopLoopFor(id, ENTRIES.get(id)?.poller.name);
      ENTRIES.delete(id);
    }
  }

  for (const entry of entries) {
    ENTRIES.set(entry.poller.id, entry);
    const running = RUNNING.get(entry.poller.id);
    if (!running) {
      startLoopFor(entry.poller.id, entry.poller.pollIntervalMs);
      continue;
    }
    // Interval changed → restart with new cadence. Rule and name edits are
    // already visible to the next tick via ENTRIES — no restart needed.
    if (running.intervalMs !== entry.poller.pollIntervalMs) {
      stopLoopFor(entry.poller.id, entry.poller.name);
      startLoopFor(entry.poller.id, entry.poller.pollIntervalMs);
    }
  }
}

export function startLinearPoller(): void {
  if (started) return;
  if (process.env.DISABLE_LINEAR_POLLER === "1") {
    console.log("[linear] poller disabled via DISABLE_LINEAR_POLLER=1");
    return;
  }
  started = true;

  // Kick off async bootstrap: seed-from-env (idempotent), then reconcile, then
  // schedule periodic reconciles. We don't `await` here because this is
  // called from instrumentation register() which is sync-ish.
  void (async () => {
    try {
      await seedFromEnvIfEmpty();
    } catch (err) {
      console.error("[linear] seed-from-env failed:", err);
    }
    try {
      await reconcile();
    } catch (err) {
      console.error("[linear] initial reconcile failed:", err);
    }
    reconcileTimer = setInterval(() => {
      void reconcile().catch((err) => {
        console.error("[linear] reconcile error:", err);
      });
    }, RECONCILE_INTERVAL_MS);
    console.log("[linear] manager started");
  })();
}

// Intentionally not exporting the rule-resolution helpers — they're internal
// to the manager. The UI talks to the DB via lib/db/linear-pollers.ts; the
// manager picks up changes on the next reconcile (every 60s).
