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
    linearPickup: integer("linear_pickup").notNull().default(0),
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
    /** Where the session came from — manual UI or the Linear poller */
    source: text("source", { enum: ["ui", "linear"] }).notNull().default("ui"),
    /** Linear issue identifier (e.g. "ENG-123") when source=linear */
    linearIssueId: text("linear_issue_id"),
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
