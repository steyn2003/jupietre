import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    /** Display name shown in the team UI. Falls back to email-local-part. */
    displayName: text("display_name"),
    isAdmin: integer("is_admin").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** The user who created the team — gets owner role automatically. */
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("member"),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    index("team_members_user_idx").on(t.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    /** Optional — when set, redeeming auto-joins the user to this team. */
    teamId: text("team_id").references(() => teams.id, {
      onDelete: "cascade",
    }),
    /** Team role granted on accept; ignored when teamId is null. */
    teamRole: text("team_role", { enum: ["owner", "member"] })
      .notNull()
      .default("member"),
    /** Random opaque token used in the invite URL. Indexed for redemption. */
    token: text("token").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invites_token_idx").on(t.token),
    index("invites_email_idx").on(t.email),
  ],
);

export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    model: text("model").notNull(),
    fallbackModel: text("fallback_model"),
    allowedTools: jsonb("allowed_tools").$type<string[] | null>(),
    disallowedTools: jsonb("disallowed_tools")
      .$type<string[]>()
      .notNull()
      .default([]),
    includeProjectSkills: integer("include_project_skills").notNull().default(1),
    maxTurns: integer("max_turns").notNull().default(100),
    effort: text("effort", { enum: ["low", "medium", "high", "max"] })
      .notNull()
      .default("high"),
    /** Optional team scope — when set, all team members can use this agent. */
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** Per-session cap (already existed). */
    maxBudgetUsd: integer("max_budget_usd"),
    /** Rolling 24h cap; refuses new sessions for this agent past the limit. */
    dailyBudgetUsd: integer("daily_budget_usd"),
    /** Calendar-month cap (UTC). Same semantics as daily. */
    monthlyBudgetUsd: integer("monthly_budget_usd"),
    /** When 1, the SDK `mcpServers` bundle includes the Linear tools. */
    enableLinearTools: integer("enable_linear_tools").notNull().default(0),
    /** When 1, the SDK `mcpServers` bundle includes the git + gh tools. */
    enableGithubTools: integer("enable_github_tools").notNull().default(0),
    /**
     * Approval policy for tool calls.
     *  - "none": legacy bypass — every tool runs without prompting.
     *  - "list": tools listed in `approvalTools` require user approval.
     *  - "all":  every tool requires user approval.
     */
    approvalMode: text("approval_mode", { enum: ["none", "list", "all"] })
      .notNull()
      .default("none"),
    approvalTools: jsonb("approval_tools")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Seconds to wait for the user to decide before auto-denying. */
    approvalTimeoutSeconds: integer("approval_timeout_seconds")
      .notNull()
      .default(300),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("agent_configs_user_slug_idx").on(t.userId, t.slug)],
);

export const repos = pgTable(
  "repos",
  {
    id: text("id").primaryKey(),
    /** Owner. Same model as agent_configs — own repos + optional team scope. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** When set, anyone on the team can use the repo in new sessions. */
    teamId: text("team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    /** Stable short label, shown in dropdowns + used as the on-disk dirname.
     *  Unique per (userId, teamId) scope via the index below. */
    slug: text("slug").notNull(),
    /** GitHub `owner/name` we cloned from. */
    githubRepo: text("github_repo").notNull(),
    /** Detected at clone time via `git remote show origin`. */
    defaultBranch: text("default_branch").notNull().default("main"),
    /** Absolute path on disk under `${DATA_DIR}/repos/<slug>`. */
    clonePath: text("clone_path").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("repos_user_slug_idx").on(t.userId, t.slug),
    uniqueIndex("repos_clone_path_idx").on(t.clonePath),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    /** Legacy column — kept for back-compat; new code reads `ownerId`. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The user who created the session. Source of truth for ownership. */
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /** When set + visibility="team", any team member can read/write the session. */
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    visibility: text("visibility", { enum: ["private", "team"] })
      .notNull()
      .default("private"),
    agentConfigId: text("agent_config_id")
      .notNull()
      .references(() => agentConfigs.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    repoLabel: text("repo_label"),
    repoPath: text("repo_path").notNull(),
    /** When set, the session is bound to a managed repo (M11). On delete the
     *  session keeps working off its existing worktree. */
    repoId: text("repo_id").references(() => repos.id, {
      onDelete: "set null",
    }),
    /** Where the session came from — manual UI, the Linear poller, or the
     *  workflow dispatcher (M12). */
    source: text("source", { enum: ["ui", "linear", "workflow"] })
      .notNull()
      .default("ui"),
    /** Linear issue identifier (e.g. "ENG-123") when source=linear */
    linearIssueId: text("linear_issue_id"),
    /** When source=linear, the poller that picked up this issue. The Linear
     *  MCP tools use this poller's API key when the session calls linear_*
     *  tools, so the agent talks to the workspace the issue actually came
     *  from (instead of "first enabled poller", which silently picks the
     *  wrong workspace when more than one poller is configured). */
    linearPollerId: text("linear_poller_id"),
    /** The Claude Agent SDK session id so we can `resume` across turns */
    sdkSessionId: text("sdk_session_id"),
    /** HEAD SHA captured on the first turn; used for `git log baseSha..HEAD` */
    baseSha: text("base_sha"),
    /** Per-session git worktree provisioned under DATA_DIR. Null on legacy
     *  rows pre-M9 — code falls back to `repoPath` in that case. */
    worktreePath: text("worktree_path"),
    /** Branch name created for the worktree (e.g. `jup/<sessionId>`). */
    worktreeBranch: text("worktree_branch"),
    /** Source branch the worktree was based on (e.g. `main`). When null,
     *  the worktree was created off the source repo's current HEAD without
     *  fetching first — legacy / local-only behavior. */
    baseBranch: text("base_branch"),
    status: text("status", {
      enum: ["idle", "running", "error"],
    })
      .notNull()
      .default("idle"),
    totalCostUsd: text("total_cost_usd").notNull().default("0"),
    /** Queued follow-up text submitted while a turn was already running.
     *  Drained by the runner the moment the current turn ends — appended
     *  as the next user turn. Multiple follow-ups are joined with "\n\n". */
    pendingUserText: text("pending_user_text"),
    /** When set, this session was forked from another. Set null on parent delete
     *  so orphans survive — they have their own copied transcript. */
    parentSessionId: text("parent_session_id"),
    /** indexInSession of the parent message the fork branched off from. */
    forkedAtMessageIndex: integer("forked_at_message_index"),
    /** M12: when set, this session is participating in a workflow run. Null for
     *  standalone UI sessions and Linear-picked sessions. The workflow dispatcher
     *  owns the lifecycle (new session vs resume via queueFollowUp). */
    workflowRunId: text("workflow_run_id"),
    /** M12: the node slug (within the workflow's definition) this session is
     *  serving. Unique per (workflowRunId, nodeSlug) in practice — that
     *  uniqueness is what the dispatcher uses to decide "new session vs resume
     *  existing session" when routing a message. */
    workflowNodeSlug: text("workflow_node_slug"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Non-unique: one Linear issue flows through multiple agents (PM → Engineer
    // → QA) and may re-enter an agent's queue (rework after QA reject), so
    // each pickup gets its own session.
    index("sessions_linear_issue_idx").on(t.linearIssueId),
    index("sessions_linear_agent_idx").on(t.linearIssueId, t.agentConfigId),
    index("sessions_parent_idx").on(t.parentSessionId),
    index("sessions_workflow_run_idx").on(t.workflowRunId),
    index("sessions_workflow_run_node_idx").on(
      t.workflowRunId,
      t.workflowNodeSlug,
    ),
  ],
);

export const sessionArtifacts = pgTable(
  "session_artifacts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["pr", "commit", "worktree", "linear_comment", "linear_issue", "file_change"],
    }).notNull(),
    url: text("url"),
    title: text("title").notNull(),
    summary: text("summary"),
    /** Optional dedupe key within a session (e.g. file path, commit sha, PR number) */
    externalId: text("external_id"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("session_artifacts_dedupe_idx").on(
      t.sessionId,
      t.kind,
      t.externalId,
    ),
  ],
);

export const toolApprovalRequests = pgTable("tool_approval_requests", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  /** Stable id used to correlate UI decisions back to the SDK callback. */
  toolUseId: text("tool_use_id"),
  args: jsonb("args").$type<Record<string, unknown>>().notNull(),
  status: text("status", {
    enum: ["pending", "approved", "denied", "timeout"],
  })
    .notNull()
    .default("pending"),
  /** Free-text reason supplied by the user on deny (optional). */
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  decidedAt: timestamp("decided_at"),
});

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    /** Owning user — ownerId of the session at the time of the event. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    agentConfigId: text("agent_config_id")
      .notNull()
      .references(() => agentConfigs.id, { onDelete: "restrict" }),
    /** Optional team scope — copied from the session at insert time. */
    teamId: text("team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    /** Cost in micro-USD (×1_000_000) so we can sum without floating-point loss. */
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    at: timestamp("at").defaultNow().notNull(),
  },
  (t) => [
    index("usage_events_user_at_idx").on(t.userId, t.at),
    index("usage_events_team_at_idx").on(t.teamId, t.at),
    index("usage_events_agent_at_idx").on(t.agentConfigId, t.at),
  ],
);

export const sessionMessages = pgTable(
  "session_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Dense per-session message index, starts at 0. Used by fork to pick a
     *  branch point and to label assistant turns ("turn N"). */
    indexInSession: integer("index_in_session").notNull().default(0),
    /** Who produced this: "user" (human), "assistant" (Claude), "system" (SDK lifecycle), "tool" (tool call/result summary) */
    kind: text("kind", {
      enum: ["user", "assistant", "system", "tool"],
    }).notNull(),
    /** Rendered text for display. */
    text: text("text").notNull(),
    /** Raw SDK message payload for debugging / richer rendering later. */
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("session_messages_session_idx_idx").on(t.sessionId, t.indexInSession)],
);

// ────────────────────────────────────────────────────────────────────
// M12 — Agent workflows
//
// Workflows are user-configurable DAGs of agents. A `workflows` row holds the
// definition (nodes + transitions + limits) as validated JSON. A `workflow_runs`
// row is one execution of a workflow. Agents hand work to each other by
// publishing `workflow_messages` (the inter-agent mailbox); the in-process
// dispatcher drains pending messages, creates or resumes sessions accordingly,
// and calls startTurn / queueFollowUp.
//
// Handoffs carry a short message payload, not a transcript — receivers look up
// any extra context they need via existing tools (gh pr diff, linear_get_issue,
// git log). See docs/superpowers/plans/2026-04-24-agent-workflows.md.
// ────────────────────────────────────────────────────────────────────

export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    /** Owner. Same model as agent_configs — own workflows + optional team scope. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** When set, anyone on the team can read/run this workflow. */
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** Stable short label, unique per (ownerId, teamId) scope. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** { nodes, transitions, limits } — validated by lib/workflows/definitions.ts
     *  on every write. Node.agentConfigId references agent_configs.id; the FK is
     *  enforced at app level because it lives inside the JSON doc. */
    definition: jsonb("definition")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("workflows_owner_slug_idx").on(t.ownerId, t.slug)],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "restrict" }),
    /** running: dispatcher is actively moving the run forward.
     *  awaiting: a node owes an answer/handoff; no work pending.
     *  done:    completed successfully via workflow_complete.
     *  error:   dispatcher aborted (budget cap, DAG violation, broken agent ref). */
    status: text("status", {
      enum: ["running", "awaiting", "done", "error"],
    })
      .notNull()
      .default("running"),
    /** Repo the run operates on. Every spawned session inherits this. */
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "restrict" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Copied from the workflow at run-start — lets team members see runs they
     *  kicked off on a team-scoped workflow. */
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** Reserved for a later phase where a Linear ticket triggers a workflow
     *  run instead of a bare session. Always null for now. */
    linearIssueId: text("linear_issue_id"),
    /** Node slug (within the workflow's definition.nodes) whose turn it is
     *  right now. Advanced by the dispatcher on each delivered message. */
    currentNode: text("current_node").notNull(),
    /** Free-form run context — initial goal string, any shared state the DAG
     *  wants to thread through. { goal: string, error?: string, ... }. */
    contextJson: jsonb("context_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("workflow_runs_workflow_idx").on(t.workflowId),
    index("workflow_runs_owner_idx").on(t.ownerId),
    index("workflow_runs_status_idx").on(t.status),
  ],
);

// ────────────────────────────────────────────────────────────────────
// Skills (UI-managed Claude Agent SDK skills)
//
// Skills used to live only in the repo's skills/ folder, surfaced to the SDK
// via settingSources: ["user", "project"]. This table makes them editable in
// the UI: each row is one Claude SKILL.md, materialized to the per-session
// worktree at <worktreePath>/.claude/skills/<slug>/SKILL.md when the runner
// builds the SDK options.
//
// Sub-files referenced from a SKILL.md (helpers, scripts) still live in the
// repo's skills/ folder. The materialization step copies the folder first
// and overlays the DB body on top, so DB rows are authoritative for SKILL.md
// while the folder provides any auxiliary files.
// ────────────────────────────────────────────────────────────────────

export const skills = pgTable(
  "skills",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Optional team scope — when set, all team members can use this skill. */
    teamId: text("team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    /** kebab-case, used as the directory name under .claude/skills/. */
    slug: text("slug").notNull(),
    /** Human label shown in the UI (also written to SKILL.md frontmatter). */
    name: text("name").notNull(),
    /** Skill-discovery hint shown to the agent. Required by the SDK to decide
     *  when to load this skill. Written to SKILL.md frontmatter. */
    description: text("description").notNull(),
    /** Markdown body — everything after the frontmatter. */
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("skills_owner_slug_idx").on(t.ownerId, t.slug)],
);

// ────────────────────────────────────────────────────────────────────
// Linear pollers (M-linear-ui)
//
// Each row in `linear_pollers` represents one polling loop bound to a Linear
// workspace (api key) and an optional team filter. Multiple rows = multiple
// independent pollers. The poller manager in lib/linear/poller.ts reads all
// enabled rows and runs one tick loop per row at that row's interval.
//
// `linear_poller_rules` is the per-status mapping the operator configures in
// the UI: "when an issue with the poller's label sits in state `pickupState`,
// hand it to `agentConfigId` and move it to `inProgressState`." The rule's
// `workflowTemplate` is the role-specific recipe injected into the agent's
// first message. When null, `lib/linear/default-workflows.ts` falls back to a
// slug-keyed default (preserved for backward-compat seeding).
// ────────────────────────────────────────────────────────────────────

export const linearPollers = pgTable(
  "linear_pollers",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Optional team scope — informational; the manager runs every enabled
     *  poller regardless of team. */
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** Display name shown in the UI ("ENG workspace", "Customer support", …). */
    name: text("name").notNull(),
    /** Linear personal API key. Plaintext for now — no field-level encryption
     *  in the codebase yet; matches how other secrets were treated when env-injected. */
    apiKey: text("api_key").notNull(),
    /** Optional Linear team key (e.g. "ENG"). When set, only that team's
     *  issues are considered. Null = all teams accessible to the API key. */
    teamKey: text("team_key"),
    /** Label that flags an issue as eligible for pickup ("agent" by default).
     *  Per-rule override on linearPollerRules.labelOverride wins when set. */
    defaultLabel: text("default_label").notNull().default("agent"),
    /** Tick cadence in milliseconds. */
    pollIntervalMs: integer("poll_interval_ms").notNull().default(120_000),
    enabled: integer("enabled").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("linear_pollers_owner_idx").on(t.ownerId)],
);

export const linearPollerRules = pgTable(
  "linear_poller_rules",
  {
    id: text("id").primaryKey(),
    pollerId: text("poller_id")
      .notNull()
      .references(() => linearPollers.id, { onDelete: "cascade" }),
    /** pickup: classic "state X + label Y → run agent Z, auto-move to W."
     *  triage: scan state X with no label filter (excluding tickets that
     *  already carry the poller's defaultLabel — those belong to pickup
     *  rules); the agent decides what labels/state to apply. There is no
     *  auto-transition in triage mode, so inProgressState is unused. */
    mode: text("mode", { enum: ["pickup", "triage"] })
      .notNull()
      .default("pickup"),
    /** Linear state name to scan for tickets (e.g. "Ready for PM" for
     *  pickup rules, or "Todo" for a triage rule). */
    pickupState: text("pickup_state").notNull(),
    /** Pickup mode: state to move issues into the moment a session is
     *  created. Null when mode='triage' (the agent decides). */
    inProgressState: text("in_progress_state"),
    agentConfigId: text("agent_config_id")
      .notNull()
      .references(() => agentConfigs.id, { onDelete: "restrict" }),
    /** Pickup mode: override the poller-level label filter for this rule
     *  (null = inherit poller.defaultLabel). Ignored in triage mode. */
    labelOverride: text("label_override"),
    /** Role-specific instructions injected into the agent's first message.
     *  Null falls back to the default keyed by mode + agent slug. */
    workflowTemplate: text("workflow_template"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("linear_poller_rules_poller_idx").on(t.pollerId),
    // (poller, mode, pickupState, agent) is the dedupe key. mode is part of
    // the key so an operator can wire the same agent against the same state
    // in both modes — e.g. a triage agent and a pickup agent both watching
    // "Todo" — without the index colliding.
    uniqueIndex("linear_poller_rules_dedupe_idx").on(
      t.pollerId,
      t.mode,
      t.pickupState,
      t.agentConfigId,
    ),
  ],
);

export const workflowMessages = pgTable(
  "workflow_messages",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    /** Null for the initial trigger; otherwise the node slug that sent this. */
    fromNode: text("from_node"),
    toNode: text("to_node").notNull(),
    /** trigger: start the run (dispatcher-internal).
     *  handoff: A → B, new session for B.
     *  ask:     A → B, new session for B with a question.
     *  answer:  B → A, resumes A's existing session via queueFollowUp.
     *  reject:  A → B, resumes B's existing session with rework notes.
     *  complete: any → (no target), closes the run. */
    kind: text("kind", {
      enum: ["trigger", "handoff", "ask", "answer", "reject", "complete"],
    }).notNull(),
    /** For handoff: HandoffPayload shape. For ask/answer/reject: { text, inReplyTo? }.
     *  For complete: { summary? }. For trigger: { goal }. */
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    /** Set by the dispatcher when it creates or resumes a session to handle
     *  this message. Null until delivered. No FK — if the session is deleted
     *  the message stays as an audit record. */
    sessionId: text("session_id"),
    /** pending: waiting for the dispatcher to pick up.
     *  delivered: dispatcher has started the session/turn.
     *  consumed: the receiving agent has acknowledged (by calling another
     *            workflow_* tool or completing a turn that observed this msg). */
    status: text("status", {
      enum: ["pending", "delivered", "consumed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),
  },
  (t) => [
    index("workflow_messages_run_idx").on(t.workflowRunId),
    index("workflow_messages_status_idx").on(t.status, t.createdAt),
    index("workflow_messages_session_idx").on(t.sessionId),
  ],
);
