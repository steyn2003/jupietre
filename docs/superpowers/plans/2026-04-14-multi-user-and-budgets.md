# Multi-User + Budget Dashboards

> Combines **M8** (multi-user + teams) and **M9** (budget + usage dashboards). Budgets become meaningfully different once multiple users share an instance — per-user caps, per-team totals. Doing them together avoids rewriting the usage schema twice.

**Goal:** Drop the single-admin constraint. Invite collaborators, optionally group them into teams, share sessions. At the same time, surface per-user, per-team, and per-agent cost with enforceable caps and a kill-switch.

---

## Chunks

### Chunk 1 — Users, teams, invites

**Schema:**
- `users` — already exists. Add `role: "admin" | "member"`, `displayName`.
- `teams` — `id, name, createdAt`.
- `team_members` — `teamId, userId, role ("owner" | "member")` — composite PK.
- `invites` — `id, email, teamId (nullable), role, token (unique), expiresAt, consumedAt`.

**Create:**
- `lib/auth/invites.ts` — create/redeem/revoke invite. Redeem creates the user, optionally adds to team, consumes token.
- `lib/auth/authz.ts` — `canReadSession`, `canWriteSession`, `canEditAgentConfig` etc. Single source of truth.
- `app/settings/team/page.tsx` — owner-only: list members, invite, remove.
- `app/invite/[token]/page.tsx` — accept-invite flow (set password, display name → login).
- `app/api/invites/route.ts` + `[id]/route.ts`.

**Modify:**
- `sessions` table — add `ownerId`, `teamId (nullable)`, `visibility ("private" | "team")`.
- `agent_configs` — add `teamId (nullable)`. If set, anyone on the team can use it; otherwise per-user as today.
- Every session/agent query → gate via `authz` helpers.
- Email sending: `lib/email/smtp.ts` — plain nodemailer over SMTP env vars. Invite email is the only outbound email for now.

### Chunk 2 — Usage schema

**Schema:**
- `usage_events` — `id, userId, sessionId, agentConfigId, model, inputTokens, outputTokens, cachedInputTokens, costUsd, at (timestamp)`. One row per SDK `result` / mid-turn usage signal.

**Modify:**
- `lib/agent/runner.ts` — on every SDK message with usage data (every assistant message that carries `usage`, or only on `result`? pick `result` for simplicity), insert a `usage_events` row.

### Chunk 3 — Caps + kill-switch

**Agent config fields (already added in M2):**
- `maxBudgetUsd` is current per-session. Add:
- `dailyBudgetUsd`, `monthlyBudgetUsd` — if exceeded, future sessions with this agent refuse to start.

**Create:**
- `lib/agent/budget.ts` — `getSpendWindow(agentConfigId, window)` → query `usage_events`. `canStartSession(config)` → compare against caps.
- `lib/agent/runner.ts` — on start, call `canStartSession`. If over cap, write a system message in the session transcript and close.

**Hook existing `CLAUDE_TOKEN_DAILY_LIMIT_USD`** into this system — it becomes the global cap alongside per-agent caps.

### Chunk 4 — Dashboard

**Create:**
- `app/usage/page.tsx` — user's view: total spend today, this month, sparkline of daily cost last 30 days, top 5 most expensive sessions, per-agent breakdown.
- `app/usage/team/page.tsx` — team owner's view: same but across all team members. Shows who spent what.
- `lib/db/usage.ts` — the aggregation queries.

**Widgets:**
- Sparkline (inline SVG, no chart lib).
- "X% of daily budget used" progress bar on the agent configs list.
- Alert banner at 80% of monthly cap.

---

## Out of scope

- Organizations larger than a single team (nested teams, cross-team sharing).
- SSO / OAuth login — stay on email+password until someone actually asks.
- Per-model pricing tables — rely on the SDK's reported cost (`total_cost_usd`). If the SDK's number is wrong, that's an upstream issue.
- Invoice generation / billing integration.

---

## Open questions

- **Default visibility** for new sessions: `private` or `team`? Recommend `team` if the user has a team, else `private`. Let the creator override.
- **Admin override on budgets:** can an admin temporarily lift a cap? Probably yes, and log it. Keep simple until this actually happens.
- **Historical usage backfill:** existing sessions have `total_cost_usd` but not per-event data. Leave historical as a single rolled-up row per session.

---

## Success criteria

1. Admin can invite a second user by email; invitee can accept and log in.
2. A team-visibility session is readable by other team members, private is not.
3. `/usage` shows my own spend today and a 30-day sparkline.
4. An agent with `dailyBudgetUsd: 1` blocks the next session start once spend crosses $1 that day.
5. Authorization helpers are the *only* place gating visibility — no ad-hoc `session.userId === me.id` checks in routes.
