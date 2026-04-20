# MCP Tools + Artifacts View

> Combines **M3** (Linear/GitHub MCP tools in UI sessions) and **M7** (surface what the agent shipped). They're the two halves of the same loop: give agents the power to ship, then show you what shipped.

**Goal:** Agents started from the UI can create worktrees, push branches, open PRs, and comment on Linear tickets — exactly like the old CLI poller. When they do, a "Results" tab on the session surfaces the artifacts (PRs, commits, files, Linear comments) instead of burying them in the message stream.

**Why combine:** MCP tools produce the artifacts; the artifacts view consumes them. Shipping one without the other leaves either invisible work or an empty tab.

---

## Chunks

### Chunk 1 — Port MCP tools into the Next app

The CLI poller at `src/tools/linear.ts` and `src/tools/github.ts` already has the shape we want. Port (don't re-import — `src/` will likely get deleted after M2 settles).

**Create:**
- `lib/agent/mcp-tools/linear.ts` — `get_issue`, `update_issue_state`, `comment_on_issue`. Wraps Linear SDK, reads token from env.
- `lib/agent/mcp-tools/github.ts` — `create_worktree`, `push_branch`, `open_pr`, `cleanup_worktree`. Shells out to `git` + `gh`.
- `lib/agent/mcp-tools/index.ts` — builds the `createSdkMcpServer` bundle.

**Modify:**
- `lib/agent/runner.ts` — pass the MCP server into `query()` options when the agent config enables it.
- `lib/db/schema.ts` (via new migration) — add `enableLinearTools` / `enableGithubTools` columns on `agent_configs` (default both `0`).
- `app/agents/agent-form.tsx` — two new toggles.

### Chunk 2 — Emit artifact events from the tools

Every MCP tool that produces something user-facing emits a structured event alongside its return value. Options:
- **(A)** tools call a `recordArtifact()` helper that inserts directly into `session_artifacts` (simple, tight coupling).
- **(B)** runner parses tool results after the fact and extracts artifacts (loose, fragile).

Recommend (A). Gives deterministic writes.

**Create:**
- `lib/db/artifacts.ts` — `recordArtifact`, `listArtifactsForSession`.
- Schema: `session_artifacts` — `id, sessionId, kind ("pr" | "commit" | "worktree" | "linear_comment" | "file_change"), url, title, summary, createdAt`.

**Also capture from non-tool sources:**
- On session finish, run `git log <baseSha>..HEAD` in the repo path → insert each commit as a `commit` artifact.
- Parse SDK `ToolUseBlock` / `ToolResultBlock` messages in runner for `Write` / `Edit` calls → dedupe file paths → one `file_change` artifact per file touched.

### Chunk 3 — Results tab UI

**Create:**
- `app/sessions/[id]/results-tab.tsx` — grouped list: PRs at top (with link), then Linear comments, then commits, then file changes. Each row is a link when possible.

**Modify:**
- `app/sessions/[id]/page.tsx` — tabs: "Chat" (default) / "Diff" (existing) / "Results" (new). Show a small badge count on "Results".

---

## Out of scope

- Approval gating for risky tool calls → that's M6.
- Artifacts across *multiple* sessions (e.g. "show me every PR this agent ever opened") → dashboard territory, defer.
- PR review state tracking (merged/closed) — add if useful, but not required for v1.

---

## Open questions

- **Worktree location:** same `/data/repos/<repo>-<session>` convention as the CLI poller? Document in `docs/AGENTS.md`.
- **Linear token per-agent vs global:** for now keep it global (`LINEAR_API_KEY` env). Per-agent token is multi-user territory (M8+M9 plan).
- **`gh` auth on the server:** assume `gh auth login` has been run manually during deploy. Document in `docs/DEPLOY.md`.

---

## Success criteria

1. An agent started from the UI can open a PR from within a session (tool call appears in stream, PR exists on GitHub).
2. The Linear poller still works (same tool set, DB-driven config from M2).
3. Results tab on any session shows the PR link, every commit, every Linear comment, and the set of files touched.
4. Turning off `enableGithubTools` on an agent config removes the github tools from its next run.
