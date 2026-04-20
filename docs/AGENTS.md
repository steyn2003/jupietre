# Agents

Jupietre sessions are driven by **agent configs** — per-user rows in the `agent_configs` table. Every session references exactly one agent by FK. You edit agents from the UI at `/agents`.

On first boot, every admin user is seeded with three built-ins (idempotent across restarts):

| Slug | Name | Model | Linear pickup |
| --- | --- | --- | --- |
| `pm` | PM | `claude-opus-4-6` | yes |
| `engineer` | Engineer | `claude-opus-4-6` | yes |
| `tester` | QA | `claude-sonnet-4-6` | yes |

Delete them, edit them, or add more — the runner only reads the DB.

## Creating an agent

Navigate to **Agents → New agent**. Every field maps to a Claude Agent SDK `query()` option at runtime:

- **Name** — human-readable label, shown on the sessions list and session header.
- **Slug** — stable, kebab-case identifier, unique per user. Used by the Linear poller to look up env vars. Cannot change after creation.
- **System prompt** — passed directly as `systemPrompt`. Keep it short; the SDK already adds its own preamble.
- **Model** / **Fallback model** — free-text. Any model ID the Anthropic API accepts works; there's no dropdown because the list changes faster than we want to ship. Fallback is used on rate-limit or model-specific errors.
- **Effort** — `low` / `medium` / `high` / `max`. Maps to `effort` on SDK options.
- **Max turns** — hard cap on agent→tool→agent cycles per turn.
- **Max budget USD** — optional cap; passed as `maxBudgetUsd`. Blank means no cap.
- **Tools** — two modes:
  - *All built-in tools* → `allowedTools: null` (SDK default).
  - *Only selected* → `allowedTools: [...]` with whatever you ticked.
- **Use repo's `.claude/settings.json`** — when on, `settingSources: ["project"]` is passed, so the agent inherits any skills/hooks defined inside the target repo.
- **Linear pickup** — when on, the Linear poller creates sessions bound to this agent for tickets whose state matches its env var (see below).
- **Linear MCP tools** — exposes `linear_get_issue`, `linear_update_issue_state`, `linear_add_comment`, `linear_update_issue`, `linear_create_issue`. Requires `LINEAR_API_KEY`.
- **GitHub MCP tools** — exposes `git_create_worktree`, `git_push_branch`, `gh_create_pr`, `git_cleanup_worktree`, `gh_pr_review`. Requires `gh` CLI authenticated on the server (the tools inherit the server process's environment). Worktrees are created under `${REPOS_BASE_DIR}/.jupietre-worktrees/<branch>`. The PR repo slug is auto-detected via `gh repo view` from the worktree (override with `GITHUB_REPO` env).

## Linear pickup + env vars

Only agents with **Linear pickup** enabled are eligible. For each such agent, the poller reads two env vars:

- `<SLUG>_PICKUP_STATE` — Linear workflow state name to monitor (e.g. `"PM Queue"`).
- `<SLUG>_IN_PROGRESS_STATE` — state to move the issue to once picked up.

Slug `foo-bar` becomes `FOO_BAR_PICKUP_STATE`. The historical `tester` slug uses `QA_PICKUP_STATE` / `QA_IN_PROGRESS_STATE` for backwards compatibility.

If the env vars aren't set, the agent is simply skipped (with a console warning) — the poller won't error.

## Artifacts + the Results panel

Every session has a collapsible **Results** panel above the chat that lists what the agent produced, grouped by kind:

- **Pull requests** — inserted when `gh_create_pr` succeeds; row links to the PR URL.
- **Linear comments / issues** — inserted when `linear_add_comment` or `linear_create_issue` succeeds.
- **Commits** — scraped from `git log <baseSha>..HEAD` when each turn finishes. `baseSha` is captured on the first turn, so commits made before the session started won't appear.
- **Files touched** — emitted whenever the agent calls `Write`, `Edit`, or `NotebookEdit` (deduped on path).
- **Worktrees** — inserted when `git_create_worktree` succeeds.

Artifacts are deduped on `(sessionId, kind, externalId)` — re-running the same tool with the same arguments updates the existing row rather than creating a duplicate.

## Deleting an agent

The `sessions.agent_config_id` FK is `ON DELETE RESTRICT`: you can't delete an agent that has historical sessions attached. Archive old sessions or switch their FK first. The UI surfaces the error message from Postgres.
