# Tool Approval Flow

> Standalone. Originally **M6**. Depends on deploy + mobile being in place (so you can approve from your phone), and on M2 agent configs (so approval policy is per-agent). Don't start this before the deploy/mobile plan.

**Goal:** Replace blanket `bypassPermissions: true` with per-call approval for risky tools. When an agent wants to run `Bash`, `Write`, or `Edit` (or anything the agent config marks as "approval-required"), the UI shows the args and you tap approve/deny from your phone. Auto-deny after a configurable timeout.

---

## Chunks

### Chunk 1 — DB + event plumbing

**Schema:**
- `tool_approval_requests` — `id, sessionId, toolName, args (jsonb), status ("pending" | "approved" | "denied" | "timeout"), decidedAt, createdAt`.

**Modify:**
- `lib/db/schema.ts` — new table.
- `lib/db/agent-configs.ts` — add `approvalPolicy` field: `{ mode: "all" | "none" | "list", tools: string[], timeoutSeconds: number }`. Default mode `"list"`, tools `["Bash", "Write", "Edit"]`, timeout `30`.
- `app/agents/agent-form.tsx` — UI for approval policy.

### Chunk 2 — Wire `canUseTool` in the runner

**Modify:**
- `lib/agent/runner.ts` — when building SDK options, if the agent's approval policy isn't `"none"`, drop `bypassPermissions` and set `canUseTool: async (name, args) => ...`.

**`canUseTool` behavior:**
1. Check policy — if this tool is auto-approved, return `{ behavior: "allow" }` immediately.
2. Insert row in `tool_approval_requests` with `status: "pending"`.
3. Emit SSE event `tool-approval-requested` with the row id + tool + args.
4. Await a decision with a `Promise` resolved by one of:
   - SSE/approval-decided event from the client (polls DB or listens on Postgres NOTIFY).
   - Timeout at `policy.timeoutSeconds` → mark row `"timeout"` → deny.
5. Return `{ behavior: "allow", updatedInput: args }` or `{ behavior: "deny", message: "User denied" }`.

**Create:**
- `lib/approvals/pubsub.ts` — in-memory `EventEmitter` keyed by request id. Simple because it all runs in one Next process.

### Chunk 3 — UI approval inline in chat

**Modify:**
- `app/sessions/[id]/chat-stream.tsx` (or wherever SSE messages render) — handle `tool-approval-requested` by injecting an "approval card" into the chat: tool name, formatted args, Approve / Deny buttons, countdown showing timeout.
- After decision, `POST /api/approvals/[id]/decide` with `{ decision: "approve" | "deny" }`. Updates the row, emits the internal event.

**Create:**
- `app/api/approvals/[id]/decide/route.ts`.

### Chunk 4 — Push integration

If the tool-approval event fires and the session has an active push subscription and no active browser tab (track with visibility API + a lightweight `/api/presence` heartbeat), fire a push notification immediately. Tapping it deep-links into the session.

---

## Out of scope

- **Per-command approval** (e.g. approve `rm -rf /tmp/x` but not `rm -rf /`). Too fiddly for v1; approval is per tool-call at the argument granularity the SDK provides.
- **Undo** after approval. If you approved wrongly, the damage is done — that's the cost of the convenience.
- **Approval audit log UI.** Row history is in DB; add a view only if you actually want to review past decisions.

---

## Open questions

- **What counts as "risky" by default?** `Bash`, `Write`, `Edit` feels right. `WebFetch` / `WebSearch` probably fine. MCP tools — default to required-approval unless the agent config opts out, since they can mutate GitHub/Linear.
- **Default timeout:** 30s is short for phone-away. Probably 5 minutes default, 30s for dev mode.
- **Offline denial:** if the phone is offline when approval fires, auto-deny is the safe default.

---

## Success criteria

1. Creating an agent with `approvalPolicy: { mode: "list", tools: ["Bash"] }` and starting a session → the agent's first `Bash` call blocks until you approve.
2. Approval card renders inline in chat; countdown visible; tap approve → tool runs; tap deny → agent gets the deny message and adapts.
3. A pending approval while no tab is open fires a push notification.
4. Auto-deny after timeout marks the request and returns deny to the agent.
5. Toggling an agent back to `approvalPolicy.mode = "none"` restores the old bypass behavior (exact `bypassPermissions: true` path).
