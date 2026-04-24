# Agent Workflows — Design

**Status:** Planned (M12). Design agreed, not yet implemented.
**Date:** 2026-04-24

**Goal:** Let agents hand work to each other as short structured messages ("a note to another colleague"), not transcript dumps. Flows are **user-configurable DB entities** — as new agents are added via `/agents`, users can compose them into new flows via `/workflows` without code changes.

---

## Core mental model

Every handoff is a **message to a colleague**, not a context transfer. The receiving agent gets:

- The sender's short note (what to do, why, acceptance criteria).
- Optional pointers (PR URL, commit SHA, Linear issue id) — **not content**.
- Nothing else. No prior transcripts. No summaries of what earlier agents did.

If the receiver needs detail, they fetch it themselves via tools they already have (`gh pr diff`, `linear_get_issue`, `git log`). Same as a human engineer reading a PR description.

This is a deliberate departure from the current Linear pipeline's `buildPriorContext()`, which summarizes prior sessions into the next agent's first message. That function stays where it is; the new system does not use it.

---

## Triangle DAG (v1)

```
         trigger
            ↓
           PM ─handoff→ Eng ─handoff→ QA ─complete→ done
                          ↑              │
                          └──── reject ───┘

Asks (any direction, bounded):
  Eng ─ask→ PM ─answer→ Eng
  QA  ─ask→ Eng ─answer→ QA
```

Ships as a seeded workflow row named `pm-eng-qa`. User can clone/edit/delete it via the UI.

---

## Schema

Three new tables plus one new column on `sessions`.

```ts
workflows                              // the *definitions* — user-editable
  id, slug, name,
  ownerId, teamId?,                    // same ACL pattern as agent_configs
  definition: jsonb,                   // { nodes, transitions, limits } — zod-validated on save
  createdAt, updatedAt

workflow_runs                          // per-execution state
  id, workflowId → workflows.id,
  status: "running" | "awaiting" | "done" | "error",
  repoId → repos.id,
  ownerId, teamId?,
  linearIssueId?,                      // nullable — later path for Linear-triggered runs
  currentNode: text,                   // node slug within the workflow
  contextJson: jsonb,                  // goal + any shared state the DAG wants to carry
  createdAt, updatedAt

workflow_messages                      // inter-agent mailbox + event log
  id, workflowRunId → workflow_runs.id,
  fromNode?: text,                     // null for the initial trigger
  toNode: text,
  kind: "trigger" | "handoff" | "ask" | "answer" | "reject" | "complete",
  payloadJson: jsonb,                  // HandoffPayload shape (below) or { text } for ask/answer
  sessionId? → sessions.id,            // set when the dispatcher creates/resumes a session for this message
  status: "pending" | "delivered" | "consumed",
  createdAt, deliveredAt

sessions.workflowRunId → workflow_runs.id  // nullable. Linear/UI sessions unaffected.
```

`agent_configs` ON DELETE → `SET NULL` on any workflow node's agent reference. If a deleted agent leaves a workflow with a null node, the workflow is marked **broken** at next dispatch attempt with a clear error — never silently wrong.

---

## The `definition` JSON

```ts
type WorkflowDefinition = {
  nodes: Record<string, {
    agentConfigId: string;                // FK → agent_configs.id
    canReceive: Array<"trigger" | "handoff" | "ask" | "answer" | "reject">;
  }>;
  transitions: Array<{
    from: string;                         // node slug
    kind: "handoff" | "ask" | "reject" | "complete";
    to?: string;                          // node slug — absent for "complete"
  }>;
  limits: {
    maxRejects?: number;                  // QA → Eng reject loops, default 3
    maxAsks?: number;                     // total ask messages per run, default 5
    maxBudgetUsd?: number;                // sum of session costs in this run
  };
};
```

Zod-validated on save. Invariants checked:
- At least one node has `"trigger"` in `canReceive` (entry point).
- At least one `"complete"` transition exists and is reachable.
- All `from`/`to` references point to declared nodes.
- No duplicate (from, kind, to) transitions.

---

## Handoff payload shape

```ts
type HandoffPayload = {
  message: string;                        // required — the note to the next person
  files?: string[];                       // optional — paths to touch
  dod?: string[];                         // optional — acceptance criteria
  outOfScope?: string[];                  // optional — guardrails
  refs?: Array<{
    kind: "pr" | "commit" | "issue" | "branch";
    value: string;                        // PR URL, SHA, issue id, branch name
  }>;
};
```

`renderHandoff(payload)` converts this into the plain markdown text the receiving agent sees as its first message. Nothing more, nothing less.

---

## Message kinds — full semantics

| Kind | Example | Target has a session in this run? | Behavior |
|---|---|---|---|
| `trigger` | User starts a run | N/A (no prior node) | Create first session for the entry-point node. |
| `handoff` | PM → Eng | No | New session for `to`. First message = `renderHandoff(payload)`. |
| `reject` | QA → Eng | **Yes** | Resume `to`'s existing session via `queueFollowUp`. SDK `resume: sdkSessionId` carries Claude context. |
| `ask` | Eng → PM | No | New session for `to` with just the question as first message. |
| `answer` | PM → Eng | **Yes** | Resume `to`'s existing session via `queueFollowUp` with the answer text. |
| `complete` | QA declares done | — | Close the run (`status = "done"`). |

This fixes an actual rough edge in today's Linear pipeline: when Hassan rejects a PR, Pieter currently gets a **new** session and loses his Claude context. In workflows, reject goes back to the **same** session — Pieter resumes with all his prior reasoning intact.

---

## Components

### `lib/workflows/definitions.ts`
Zod schema for `WorkflowDefinition`. Used by API routes to validate on create/update. Also houses the seeded `pm-eng-qa` triangle that's inserted on first boot per user (mirrors `ensureBuiltInAgentConfigs`).

### `lib/workflows/runs.ts`
Data layer: `createRun`, `publishMessage`, `nextPendingMessage`, `markDelivered`, `markConsumed`, `sessionForNode(runId, nodeSlug)` (returns existing session for that node if any).

### `lib/workflows/dispatcher.ts`
In-process poller, same pattern as `startLinearPoller`:
- Every ~2s (configurable), selects `workflow_messages` with `status = 'pending'`.
- For each: look up the workflow's node config → find the agent → check if that node already has a session in this run → either create a new session or resume the existing one.
- New session: insert `sessions` row with `workflowRunId`, provision worktree off the run's repo, call `startTurn(sessionId, renderHandoff(payload))`.
- Resume existing: call `queueFollowUp({ sessionId, userText: payload.text })`. If that session isn't running, also call `startTurn` to drain the queue.
- Mark message `delivered` (transaction with session creation/update).
- Enforce DAG + limits before dispatching; on violation, mark run `error` with reason in `contextJson.error`.
- Started from `instrumentation.ts` next to the Linear poller. Single process, no Redis — same scale assumptions as the rest of the app.

### `lib/agent/mcp-tools/workflow.ts`
New MCP tools, auto-wired by `buildMcpServersForSession` **only when the session has a non-null `workflowRunId`**:

| Tool | Payload | Effect |
|---|---|---|
| `workflow_handoff` | `{ to, payload: HandoffPayload }` | Publishes `kind:"handoff"` message. Dispatcher delivers. |
| `workflow_ask` | `{ to, question }` | Publishes `kind:"ask"` message. |
| `workflow_answer` | `{ messageId, answer }` | Publishes `kind:"answer"` message. `messageId` is the `ask` this responds to; dispatcher routes back to the asker's session. |
| `workflow_complete` | `{ summary? }` | Publishes `kind:"complete"` message. Dispatcher closes the run. |

Each tool validates the call against the workflow's transitions before inserting — agents can't handoff to an illegal target. Error returned to the agent as a tool result, which it can read and retry.

### API + UI

- `POST /api/workflows` — create workflow (validated definition).
- `GET /api/workflows` — list (ACL-gated via `lib/auth/authz.ts`, same pattern as agents).
- `GET/PATCH/DELETE /api/workflows/[id]`.
- `POST /api/workflows/[id]/runs` — start a run (`{ goal, repoId }`).
- `GET /api/workflows/runs/[runId]` — run state + message log.

UI pages:
- `/workflows` — list, "New workflow" button.
- `/workflows/[id]/edit` — form: name/slug, nodes table (node slug + agent dropdown from your `agent_configs`), transitions table (from / kind / to dropdowns), limits (numeric inputs), JSON preview for power users.
- `/workflows/[id]/runs/[runId]` — timeline view of `workflow_messages` + links to each spawned session (reuses existing session transcript rendering).
- Top nav: "Workflows" entry next to "Agents" / "Repos".

No drag-and-drop canvas in v1. Form + JSON preview is enough to prove the primitive. A visual editor is a later UX improvement.

---

## Phases (delivery order)

1. **Schema + data layer** — tables, drizzle migration, zod validator, `lib/workflows/runs.ts`, `lib/workflows/definitions.ts`, seeder for `pm-eng-qa`. Tests for validator + CRUD.
2. **Dispatcher** — `lib/workflows/dispatcher.ts`, wired into `instrumentation.ts`. Unit tests covering new-session-vs-resume branching, DAG enforcement, limit enforcement.
3. **MCP tools** — `lib/agent/mcp-tools/workflow.ts`, wired into `buildMcpServersForSession`. Integration test: trigger a run, verify dispatcher spawns the right sessions in the right order.
4. **API routes** — workflow CRUD + run trigger + run-state read. ACL via `lib/auth/authz.ts`. API tests.
5. **UI** — `/workflows` pages. Manual-test: create a workflow from scratch, start a run, watch it bounce through the triangle.

Each phase merges independently. Phase 1–3 alone gives you working flows driven by the API (no UI). Phase 5 is additive polish.

---

## Coexistence with Linear pipeline

Zero changes to `lib/linear/poller.ts`, `buildPriorContext`, or the existing `sessions` flow. A Linear ticket today creates a session exactly as before, just with `workflowRunId = null`. Workflow runs are purely additive.

A future phase (not in this plan) can add a Linear adapter that spawns a `workflow_run` instead of a bare session when a ticket arrives — at which point the two pipelines converge. Deliberately deferred until the primitive is proven.

---

## Open questions (decide at implementation time)

- **Dispatcher poll interval.** 2s is cheap (same single-process model as Linear poller). LISTEN/NOTIFY is a future optimization once there's a second Node process.
- **Message retention.** Do `workflow_messages` prune after N days, or live forever as audit trail? Default to forever — small rows, cheap.
- **Run cancellation UX.** Stop button on `/workflows/[id]/runs/[runId]` marks run `error` and aborts any running child session. Phase 5.
- **Visual editor.** Out of scope for v1. React Flow / reactflow-pro is an obvious choice when we get there.

---

## What explicitly is NOT in this plan

- Visual DAG editor (form-based only for v1).
- Linear → workflow-run trigger (Linear pipeline stays as-is).
- Cross-run context or memory (each run is independent).
- Agent-to-agent direct RPC (all communication goes through `workflow_messages` for observability).
- Parallel fan-out to multiple agents from one handoff (v1 is one-to-one transitions only; multi-target is a later extension).
