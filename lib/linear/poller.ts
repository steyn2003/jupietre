import "server-only";
import { and, desc, eq, sql as dsql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { sessionMessages, sessions, users } from "@/lib/db/schema";
import { listAgentConfigs, type AgentConfig } from "@/lib/db/agent-configs";
import { listAllRepos, type Repo } from "@/lib/repos/manager";
import { provisionWorktree } from "@/lib/worktrees/manager";
import { startTurn } from "@/lib/agent/runner";

interface PickupConfig {
  agent: AgentConfig;
  pickupState: string;
  inProgressState: string;
  label: string;
}

function envKeyForSlug(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

// ────────────────────────────────────────────────────────────────────
// Workflow definitions — injected into every Linear-triggered first
// message. Each role's "Hand off" step requires a STRUCTURED Linear
// comment so the next agent in the chain can find what's relevant to
// their role without scanning the whole ticket.
// ────────────────────────────────────────────────────────────────────

const PM_WORKFLOW = `## Workflow (PM)

1. **Picked up** — start with linear_add_comment posting:
   \`👋 **Joseph (PM)** picked this up — starting prep.\`
2. **Read** the ticket via linear_get_issue — full description, comments, labels.
   If you previously asked questions and got replies, incorporate them and skip to step 5.
3. **Repo label** — the ticket MUST have a label matching a registered repo. If
   missing, post a comment via linear_add_comment asking which repo, move to
   "Waiting" with linear_update_issue_state, and stop.
4. **Clarify if needed** — if the ticket has the "noQuestions" label, skip this
   step. Otherwise, if the ticket is too vague, post specific questions via
   linear_add_comment, move to "Waiting", and stop.
5. **Size check** — if too large (3+ unrelated modules), split into
   independently-mergeable sub-issues via linear_create_issue.
6. **Enrich** — read the current description with linear_get_issue, then call
   linear_update_issue with an APPENDED description: file paths, key functions,
   patterns, edge cases, Definition of Done, test cases. Never overwrite.
7. **Coding prompt** — append a 1-2 sentence coding prompt at the bottom of the
   description: [Action] [thing] in [location], [constraint].
8. **Hand off** — call linear_update_issue_state to move to "In Development",
   then linear_add_comment with this EXACT structured handoff (Pieter the
   engineer will read this first):

   \`\`\`
   ## ➡️ Handoff to Pieter (Engineer)
   **Coding prompt:** <one-sentence action>
   **Files to touch:** <bullet list of paths>
   **Patterns to follow:** <bullet list>
   **Definition of Done:** <bullet list of acceptance criteria>
   **Out of scope:** <what NOT to change>
   \`\`\`

## Rules
- Always APPEND to description, never overwrite.
- Final assistant text is NOT the deliverable. The deliverable lives on Linear.
- You are NOT done until linear_update_issue (description) AND
  linear_add_comment (structured handoff) AND linear_update_issue_state (move
  forward) have ALL been called.`;

const ENGINEER_WORKFLOW = `## Workflow (Engineer)

1. **Picked up** — start with linear_add_comment posting:
   \`👋 **Pieter (Engineer)** picked this up — starting work.\`
2. **Understand** — linear_get_issue to read description, comments, and Joseph's
   structured "## ➡️ Handoff to Pieter" block in the latest comments. That
   block IS your scope — files to touch, patterns, DoD. If a QA agent (Hassan)
   previously rejected, find his "## ❌ Rework needed" comment instead — that
   is your scope.
3. **Plan** — write a numbered, dependency-ordered implementation plan. Each
   step is one small verifiable change with a specific file + function.
4. **Execute** — implement step-by-step in the repo working directory. Use
   conventional commits (feat:, fix:, refactor:). Push after each commit.
5. **Verify** — run build/tests in the worktree. Fix failures one step at a time.
6. **Ship** — push the branch, create the PR via gh tools (reference the Linear
   issue, list completed steps), then linear_update_issue_state to move to
   "In Review".
7. **Hand off** — linear_add_comment with this EXACT structured handoff (Hassan
   the QA agent will read this first):

   \`\`\`
   ## ➡️ Handoff to Hassan (QA)
   **PR:** <PR url>
   **Branch:** <branch name>
   **Acceptance criteria addressed:**
   - [x] <criterion 1> — <how it was addressed>
   - [x] <criterion 2> — <how it was addressed>
   **What to test:** <bullet list of scenarios>
   **Known limitations / not in scope:** <if any>
   \`\`\`

## Rules
- No questions to chat — make reasonable decisions and proceed.
- Small, focused conventional commits. No debug logs or unrelated changes.
- You are NOT done until the PR is created AND linear_update_issue_state has
  moved the ticket to "In Review" AND linear_add_comment has posted the
  structured handoff with the PR link.`;

const QA_WORKFLOW = `## Workflow (QA)

1. **Picked up** — start with linear_add_comment posting:
   \`👋 **Hassan (QA)** picked this up — starting review.\`
2. **Read** — linear_get_issue. Find Pieter's "## ➡️ Handoff to Hassan" block in
   the latest comments — that is your scope (PR url, acceptance criteria, what
   to test).
3. Check out the PR branch and read the diff (\`git diff origin/main...HEAD\`).
4. For each acceptance criterion, check whether the diff addresses it. Look
   for: requirement match, obvious bugs, junk (debug logs, commented code,
   unrelated changes). Do NOT review style/architecture. Do NOT run
   builds/tests/linters.
5. **Decide** —
   **Approve:** gh_pr_review approve, linear_update_issue_state → "Ready for
   Review", then linear_add_comment with this EXACT structured handoff:

   \`\`\`
   ## ✅ Approved by Hassan (QA)
   **PR:** <url>
   **Verified:**
   - [x] <criterion 1>
   - [x] <criterion 2>
   \`\`\`

   **Reject:** gh_pr_review request-changes citing the specific gaps,
   linear_update_issue_state → "In Development", then linear_add_comment with
   this EXACT structured handoff (Pieter will read this first on rework):

   \`\`\`
   ## ❌ Rework needed — Hassan (QA) → Pieter (Engineer)
   **PR:** <url>
   **Gaps to address:**
   - [ ] <gap 1 — specific, with file/line if possible>
   - [ ] <gap 2>
   **Out of scope for this rework:** <anything that does NOT need fixing>
   \`\`\`

## Rules
- Be FAST. 3-7 tool calls total.
- One sentence per gap.
- A reject WITHOUT the structured "## ❌ Rework needed" comment AND WITHOUT
  linear_update_issue_state is a broken handoff — Pieter will never see the
  rejection. Both calls are required.`;

function workflowForSlug(slug: string): string {
  switch (slug) {
    case "pm":
      return PM_WORKFLOW;
    case "engineer":
      return ENGINEER_WORKFLOW;
    case "tester":
    case "qa":
      return QA_WORKFLOW;
    default:
      return `## Workflow\n\nThis ticket was triggered by the Linear poller. ` +
        `Use the linear_* tools to read the ticket, push your output back to ` +
        `Linear (description updates and/or comments), and call ` +
        `linear_update_issue_state to move the ticket to the correct next ` +
        `state when you finish. Do not return findings only in chat.`;
  }
}

function loadPickupConfigs(agents: AgentConfig[]): PickupConfig[] {
  const list: PickupConfig[] = [];
  for (const agent of agents) {
    if (agent.linearPickup !== 1) continue;
    const envBase = envKeyForSlug(agent.slug);
    // Legacy tester used QA_* env vars; preserve that mapping.
    const pickupKey =
      agent.slug === "tester" ? "QA_PICKUP_STATE" : `${envBase}_PICKUP_STATE`;
    const inProgressKey =
      agent.slug === "tester"
        ? "QA_IN_PROGRESS_STATE"
        : `${envBase}_IN_PROGRESS_STATE`;
    const pickup = process.env[pickupKey];
    const inProgress = process.env[inProgressKey];
    if (!pickup || !inProgress) {
      console.warn(
        `[linear] Skipping agent '${agent.slug}' — ${pickupKey} / ${inProgressKey} not set`,
      );
      continue;
    }
    list.push({
      agent,
      pickupState: pickup,
      inProgressState: inProgress,
      label: "agent",
    });
  }
  return list;
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

  const { listAgentConfigs } = await import("@/lib/db/agent-configs");
  const userId = await findAdminUserId();
  if (!userId) return null;
  const allAgents = await listAgentConfigs(userId);
  const agentNameById = new Map(allAgents.map((a) => [a.id, a.name]));

  const lines: string[] = ["## Prior agent activity on this ticket"];
  for (const s of others.slice(0, 3)) {
    const name = agentNameById.get(s.agentConfigId) ?? "Unknown agent";
    const when = s.createdAt.toISOString().slice(0, 16).replace("T", " ");
    // Last assistant text from that session — tells you what they ended on.
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

async function pollOnce(): Promise<void> {
  const { LinearClient } = await import("@linear/sdk");
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return;

  const userId = await findAdminUserId();
  if (!userId) return;

  const agents = await listAgentConfigs(userId);
  const configs = loadPickupConfigs(agents);
  if (configs.length === 0) return;

  const client = new LinearClient({ apiKey });
  const repoMap = await buildRepoMap();

  for (const cfg of configs) {
    const issues = await client.issues({
      filter: {
        state: { name: { eqIgnoreCase: cfg.pickupState } },
        labels: { some: { name: { eqIgnoreCase: cfg.label } } },
      },
    });

    for (const issue of issues.nodes) {
      // Gate per-(issue, agent), not per-issue. The same Linear ticket flows
      // through PM → Engineer → QA, and may re-enter Engineer's queue after
      // a QA reject. Each pickup gets its own session, but we MUST avoid
      // double-pickups while a session for this (issue, agent) is in flight.

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

      // (b) If THIS agent's last session for this issue was created very
      //     recently (within the cooldown), the ticket hasn't actually
      //     re-transitioned into our pickup state — Linear just hasn't moved
      //     on yet. Skip to avoid the same agent looping on its own residue.
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
        const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
        const ageMs = Date.now() - lastForThisAgent.createdAt.getTime();
        if (ageMs < COOLDOWN_MS) continue;
      }

      const issueLabels = (await issue.labels()).nodes.map((l) =>
        l.name.toLowerCase(),
      );
      let repo: Repo | undefined;
      for (const lbl of issueLabels) {
        const r = repoMap.get(lbl);
        if (r) {
          repo = r;
          break;
        }
      }
      if (!repo) {
        console.warn(
          `[linear] ${issue.identifier} has no label matching a registered repo (slugs: ${Array.from(
            repoMap.keys(),
          ).join(", ") || "(none)"}) — skipping`,
        );
        continue;
      }
      const repoPath = repo.clonePath;
      const repoLabel = repo.slug;

      try {
        const team = await issue.team;
        if (team) {
          const states = await team.states();
          const target = states.nodes.find(
            (s) => s.name.toLowerCase() === cfg.inProgressState.toLowerCase(),
          );
          if (target) {
            await client.updateIssue(issue.id, { stateId: target.id });
          }
        }
      } catch (err) {
        console.error(
          `[linear] Failed to move ${issue.identifier} to ${cfg.inProgressState}:`,
          err,
        );
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
        repoId: repo.id,
        source: "linear",
        linearIssueId: issue.identifier,
        status: "idle",
      });

      // Provision the per-session worktree off the registered repo's default
      // branch — same flow as UI-created sessions.
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
          `[linear] worktree provisioning failed for ${issue.identifier}; running against clone:`,
          err,
        );
      }

      const workflow = workflowForSlug(cfg.agent.slug);
      const priorContext = await buildPriorContext(
        issue.identifier,
        cfg.agent.id,
      );
      const firstMessage =
        `Linear ticket ${issue.identifier}: ${issue.title}\n\n` +
        `Description:\n${issue.description ?? "(no description)"}\n\n` +
        `Repo working directory: ${repoPath}\n\n` +
        (priorContext ? priorContext + "\n\n" : "") +
        workflow +
        `\n\nThis ticket was triggered from the Linear poller. All progress, ` +
        `findings, and questions MUST be pushed back to Linear via the ` +
        `linear_* tools — not posted only in chat. The chat is for the ` +
        `operator to observe; Linear is the source of truth for the ticket.`;

      console.log(
        `[linear] Created session for ${issue.identifier} (${cfg.agent.slug}) in ${repoLabel}`,
      );
      void startTurn({ sessionId, userText: firstMessage });
    }
  }
}

let started = false;

export function startLinearPoller(): void {
  if (started) return;
  if (process.env.DISABLE_LINEAR_POLLER === "1") {
    console.log("[linear] poller disabled via DISABLE_LINEAR_POLLER=1");
    return;
  }
  started = true;

  const intervalMs = Number(process.env.POLL_INTERVAL_MS) || 120_000;
  console.log(`[linear] poller starting — every ${intervalMs / 1000}s`);

  const tick = () => {
    pollOnce().catch((err) => {
      console.error("[linear] poll error:", err);
    });
  };

  setTimeout(tick, 5_000);
  setInterval(tick, intervalMs);
}
