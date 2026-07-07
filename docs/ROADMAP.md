# Jupietre Agents — Roadmap

Living document. What's shipped, what's next, what's intentionally deferred. Each milestone has a dedicated plan under `docs/superpowers/plans/` when it gets picked up.

---

## Where we are (April 2026)

**Shipped:**
- Postgres + admin auth (first-run bootstraps `ADMIN_EMAIL` / `ADMIN_PASSWORD`)
- Sessions UI: create session, pick agent + repo, stream Claude Agent SDK output via SSE
- Multi-turn chat (SDK `resume: sdkSessionId`), conversation persisted to Postgres
- Linear poller unified into the Next.js process — tickets create UI sessions with a "Linear" badge
- Diff panel on each session: branch, changed files, `git diff HEAD`, recent commits, worktree list
- **Configurable agents** — create/edit agents via `/agents` UI; name, system prompt, model, tools, budget, Linear pickup all editable per-user
- **MCP tools + Results tab** — per-agent toggles for Linear (`linear_*`) and GitHub (`git_*` / `gh_*`) tools; sessions display a Results panel with PRs, commits, Linear comments, and touched files
- **Deploy + iPhone PWA** — `Dockerfile.web` (multi-stage, standalone Next bundle), `docker-compose.yml` with `web` + `postgres` + `caddy` (auto-TLS via ACME), env validation at boot, `app/manifest.ts` + SVG icons + safe-area CSS for "Add to Home Screen". `docs/DEPLOY.md` is the playbook.
- **Tool approval flow** — per-agent policy (none / selected tools / all) with configurable timeout. Agent's tool calls block on `canUseTool` until the user taps Approve/Deny in the chat (with optional deny reason); auto-denies on timeout. Pending approvals persist across page reloads and resolve via SSE.
- **Multi-user + budgets** — teams, invites, team-visibility sessions, team-scoped agents. `lib/auth/authz.ts` gates every read. Per-agent daily + monthly budget caps with a runner kill-switch. Per-turn `usage_events` surface in `/usage` (own) and `/usage/team` (team owner view) with 30-day sparkline, per-agent breakdown, top sessions. Invite links shown on-screen (no SMTP yet).
- **Session branching + rewind** — "↯ Fork from here" on any assistant message creates a new private session that copies the parent transcript up to that turn. The runner replays the copied transcript as a prompt prefix on the first turn so the agent has full context, then resumes its own SDK session id from there on. Forked sessions show a breadcrumb back to the parent.
- **Code review panel** — clickable changed-files list inside the Diff section. Selecting a file fetches per-file patch + current contents (`/api/sessions/[id]/diff/file`), renders both via `shiki` server-side highlighting (single in-process highlighter cache, no client grammars), with Patch / Current file tabs. Refuses files >256 KB or binary with a friendly notice. Each file shows `↗ turn N` chips that anchor-jump back to the assistant message that wrote it.
- **Per-session worktrees in `./data/`** — every new session is automatically provisioned a git worktree at `${DATA_DIR}/worktrees/<sessionId>` on branch `jup/<sessionId>`, off the source repo's HEAD. Runner cwd, diff API, file-diff API, baseSha capture, and commit-artifact capture all run in the worktree — your source repo is never touched by the agent. Forks get their own worktree off the same source. Session delete tears down the worktree (`git worktree remove --force` + `rm -rf` fallback). Legacy pre-M9 sessions keep working against `repoPath` directly.
- **Fresh source before worktree** — New session form has a "Base branch" input (default `main`). When set, `provisionWorktree` does `git fetch origin <branch>` + creates the worktree off `origin/<branch>` so every session starts from upstream HEAD, never stale local. Falls back to source HEAD with a console warning if origin or the branch doesn't exist (works for purely local repos). Session header shows `↳ origin/<branch>` when set; forks inherit the parent's base branch.
- **Managed repos** — Repos are now first-class entities with a `/repos` UI: add a GitHub `owner/name` + slug → app clones via HTTPS (using `GITHUB_TOKEN` for private) into `${DATA_DIR}/repos/<slug>`, detects the default branch, persists. New session form picks from a dropdown of registered repos (no more raw paths). Same own/team ACL as agents. The Linear poller reads repos from the DB and matches Linear labels by slug. Default base branch auto-fills from the repo when picking it.

**Known limitations:**
- No push notifications (deferred; HTTPS unblocks but VAPID + subscription store is its own thing)
- Invites are display-only links — SMTP not wired (drop-in `lib/email/smtp.ts` is a follow-up)

---

## Milestone map

Each milestone ships a working slice. Small, shippable, orderable — you can skip around if priorities shift.

### M2 — Configurable agents ✅ shipped

Users can create/edit agents via the `/agents` UI: name, system prompt, model, tool picker, project-skills toggle, effort, budget, Linear pickup. Built-ins (`pm`, `engineer`, `tester`) seed on first boot for any user. Sessions reference agents by FK; hardcoded roles removed.

See [`docs/AGENTS.md`](./AGENTS.md) for UX details.

Plan: [`docs/superpowers/plans/2026-04-14-configurable-agents.md`](./superpowers/plans/2026-04-14-configurable-agents.md)

---

### M3 — MCP tools + Artifacts view ✅ shipped

UI sessions can use Linear (`linear_*`) and GitHub (`git_*`, `gh_*`) MCP tools based on per-agent toggles. Artifacts (PRs, commits, Linear comments, Linear issues, worktrees, files touched) are captured as they happen and surfaced in a per-session Results panel.

Worktrees live at `${REPOS_BASE_DIR}/.jupietre-worktrees/<branch>`. Commit artifacts are emitted from `git log <baseSha>..HEAD` when a turn finishes. See [`docs/AGENTS.md`](./AGENTS.md) for the toggle UX.

Plan: [`docs/superpowers/plans/2026-04-14-mcp-tools-and-artifacts.md`](./superpowers/plans/2026-04-14-mcp-tools-and-artifacts.md)

---

### M4 — Deploy + iPhone PWA ✅ shipped

Self-hosted on a single Linux server with own domain. Stack: Postgres + Next standalone (`Dockerfile.web`) + Caddy 2 reverse proxy with auto-ACME TLS. Env validation (`lib/env.ts`) fails closed in production on missing required vars. PWA manifest + SVG icons + safe-area / keyboard-inset CSS so iPhone "Add to Home Screen" opens Jupietre full-screen with no URL bar.

Worktrees + `gh` CLI auth persist across container restarts via named volumes (`jupietre-repos`, `jupietre-gh-config`). See [`docs/DEPLOY.md`](./DEPLOY.md) for the end-to-end playbook.

Plan: [`docs/superpowers/plans/2026-04-14-deploy-and-pwa.md`](./superpowers/plans/2026-04-14-deploy-and-pwa.md)

---

### M5 — Tool approval flow ✅ shipped

Per-agent approval policy (`none` / `list` / `all`) with configurable timeout. When enforced, the runner attaches a `canUseTool` callback (and drops `bypassPermissions`) that inserts a `tool_approval_requests` row, emits an SSE `approval-requested` event, and awaits a decision via in-memory pubsub or auto-denies on timeout. UI: amber approval card inline in chat with countdown, Approve / Deny / Deny-with-reason. Pending approvals are server-hydrated on page load so a refresh keeps the card visible.

Plan: [`docs/superpowers/plans/2026-04-14-tool-approval.md`](./superpowers/plans/2026-04-14-tool-approval.md)

---

### M6 — Multi-user + Budgets ✅ shipped

Teams + invites + team-visibility sessions + team-scoped agents. `lib/auth/authz.ts` is the single gate (`canRead/WriteSession`, `canUse/EditAgent`) — every session/agent read now routes through it. Per-agent daily/monthly caps kill-switch the runner before a turn starts. `usage_events` are inserted as per-turn deltas from the SDK `result` message, surfaced in `/usage` (own) and `/usage/team` (team-wide) with today/month totals, a 30-day sparkline, per-agent and per-member breakdowns, and top sessions.

SMTP is intentionally deferred — invite links appear on-screen for the admin to share. Nodemailer drop-in is a follow-up.

Plan: [`docs/superpowers/plans/2026-04-14-multi-user-and-budgets.md`](./superpowers/plans/2026-04-14-multi-user-and-budgets.md)

---

### M7 — Session branching + rewind ✅ shipped

Schema adds `parent_session_id` + `forked_at_message_index` on `sessions` and a dense `index_in_session` on `session_messages`. `lib/sessions/fork.ts` copies the parent row + messages up to the chosen turn into a new private session with a fresh `sdkSessionId`. On the first turn after a fork, `lib/agent/runner.ts` builds a transcript from the copied messages and prepends it to the prompt sent to the SDK so the agent inherits context — subsequent turns use normal SDK `resume`. UI: hover any assistant message → "↯ Fork from here" button; forked sessions show "↯ forked from <parent.title> @ turn N" breadcrumb.

Plan: [`docs/superpowers/plans/2026-04-14-session-branching.md`](./superpowers/plans/2026-04-14-session-branching.md)

---

### M8 — Code review panel ✅ shipped

Click any file in the Diff section's changed-files list → renders syntax-highlighted patch + current contents in tabs (`shiki` server-side, in-process highlighter cache, no grammars in the client bundle). `lib/git/file-diff.ts` returns `{ patch, currentContents, isBinary, sizeBytes, language, hunks }` with path-traversal safety and a 256 KB cap. The runner now stamps `indexInSession` onto `file_change` artifacts so the panel can show `↗ turn N` chips that anchor-jump back to the assistant message that wrote the file (`id="msg-N"` on assistant bubbles).

Plan: [`docs/superpowers/plans/2026-04-14-code-review-panel.md`](./superpowers/plans/2026-04-14-code-review-panel.md)

---

### M9 — Per-session worktrees in `./data/` ✅ shipped

`DATA_DIR` (default `./data`, gitignored) is the new home for Jupietre-managed state. Session creation calls `provisionWorktree()` which runs `git worktree add -b jup/<sessionId> ${DATA_DIR}/worktrees/<sessionId> HEAD` against the source `repoPath` and stores the result on the row (`worktreePath`, `worktreeBranch`, `baseSha`). Every code path that previously read `repoPath` (runner cwd, MCP server bundle, `getRepoDiff`, `getFileDiff`, commit-artifact capture) now reads `worktreePath ?? repoPath` — the source repo is read-only as far as the agent sees. Forks provision their own worktree off the same source. New `DELETE /api/sessions/[id]` route + trash button on the session header (owner-only) tears the worktree down (`git worktree remove --force` then `rm -rf` fallback). Docker compose adds a `jupietre-data` named volume mounted at `/app/data`.

---

### M10 — Fresh source before worktree ✅ shipped

`provisionWorktree({ baseBranch })` now runs `git fetch origin <branch>` and creates the worktree off `origin/<branch>` so every session starts from current upstream — never week-old local state. Schema adds `sessions.baseBranch` (nullable). New session form has a "Base branch" input (defaults to `main`); blank means "use source HEAD without fetching" for back-compat with purely local repos. Fetch failure (no remote, missing branch) falls back to source HEAD with a `[worktree]` warning. Forks inherit the parent's `baseBranch`. Session header shows `↳ origin/<branch>` when set.

---

### M11 — Managed repos ✅ shipped

Repos move from env (`GITHUB_REPOS`) to a first-class `repos` table with own/team ACL (mirrors agents). New `/repos` UI: list visible repos, add via `owner/name` + slug → `lib/repos/manager.ts:registerRepo` clones over HTTPS (embeds `GITHUB_TOKEN` for private) into `${DATA_DIR}/repos/<slug>`, detects default branch via `symbolic-ref origin/HEAD`. Slug auto-suggests from the GitHub repo name. New session form replaces the raw-path input with a repo dropdown; picking a repo auto-fills its default branch. Linear poller reads from the DB (matches Linear labels against `repo.slug`) and provisions the per-session worktree off the registered repo's default branch. Session-create API accepts either `repoId` (new) or `repoPath` (legacy) — old callers keep working until they're migrated. Repos are deletable (`DELETE /api/repos/[id]`) — cascades sessions' `repoId` to null while leaving their existing worktrees alive. Top nav gets a "Repos" entry.

---

### M12 — Agent workflows (configurable multi-agent flows) ✅ shipped

Agents hand work to each other as **messages between colleagues**, not context dumps. Each handoff carries a short structured payload (note + optional files/DoD/refs) — the receiving agent looks up anything else it needs via existing tools (`gh pr diff`, `linear_get_issue`, `git log`). Triangle DAG (PM → Eng → QA with reject loops and clarifying asks) seeds per user; **flows themselves are first-class DB entities** — `/workflows` UI lets users compose new flows from their configured agents as they add more.

Schema: `workflows` (definition JSON, zod-validated with reachable-complete, canReceive-consistency, and no-dup-transition invariants), `workflow_runs` (per-execution state with limits + `contextJson.error`), `workflow_messages` (inter-agent mailbox + audit log, statuses `pending / delivered / consumed`), and nullable `sessions.workflowRunId` + `workflowNodeSlug`. Dispatcher is an in-process poller alongside `startLinearPoller` — drains pending messages every 2s, creates a new session for `trigger / handoff / ask` or resumes the target node's existing session via `queueFollowUp` for `reject / answer`. On `complete` the run closes; any DAG violation or over-limit run flips to `error` with a readable reason. Five MCP tools exposed only when `session.workflowRunId` is set: `workflow_handoff`, `workflow_ask`, `workflow_answer`, `workflow_reject`, `workflow_complete`. Five routes plus UI: `/workflows` list, `/workflows/new`, `/workflows/[id]/edit` (structured nodes+transitions form with live zod validation + JSON preview), `/workflows/[id]/run` (start with repo + goal), `/workflow-runs/[runId]` (timeline of messages + linked sessions). Existing Linear pipeline untouched — workflow runs are a parallel path.

Plan: [`docs/superpowers/plans/2026-04-24-agent-workflows.md`](./superpowers/plans/2026-04-24-agent-workflows.md)

---

### M13 — Mission Control (`/work`) ✅ shipped

One ledger over everything the OS is doing. `/work` unions standalone sessions (workflow-run children fold under their run) with workflow runs into a single date-grouped list: origin badge (Manual / Linear issue id / Agent / Schedule / Event / Workflow), derived live state (`running / needs approval / awaiting / error / done / idle` — pending `tool_approval_requests` roll up to the owning session or run), and outcome chips (commit count + external PR links from `session_artifacts`). Header shows active / needs-attention / PRs-this-week counts plus filter chips driven by `?f=` search params — server-rendered, zero client JS. Pure query over existing tables; no schema change. Nav gains a primary "Work" entry.

---

## Explicitly out of scope

Decisions made deliberately — reopen only with a strong reason.

- **Custom sandbox implementation.** We use Claude Code's process model. Sandboxing agent work is a container-level concern (M4 deploy). We won't build a per-session VM like Open Harness.
- **Model providers other than Anthropic.** Claude Agent SDK requires Claude. If we ever want OpenAI/local models, that's a fork, not a feature.
- **Replacing the Claude Agent SDK.** The SDK handles tool routing, streaming, session resume, MCP — reinventing it is a year of work and gains nothing.

---

## How to pick the next milestone

Each milestone is independent. Pick whichever unblocks you first:

- **Can't build the next agent type without code change?** → M2
- **Tickets pile up because agents can't auto-PR, or you can't see what agents shipped?** → M3
- **Your laptop is always open because it's hosting the app, or you miss questions because the tab is closed?** → M4
- **You want to stop rubber-stamping risky tool calls?** → M5 (needs M4)
- **You want collaborators and/or spend caps?** → M6
