# Session Branching + Rewind

> Standalone. Originally **M10**. Nice-to-have — don't start until everything else is solid.

**Goal:** Fork a session at any turn. Rewind to an earlier assistant message and diverge along a new prompt. Useful for A/B-testing system prompts, recovering from a bad agent path without starting over, and exploring alternate approaches to the same ticket.

---

## Chunks

### Chunk 1 — Schema + fork mechanics

**Schema:**
- `sessions` — add `parentSessionId (nullable)`, `forkedAtMessageIndex (nullable)`.
- `session_messages` — already stores assistant/user messages. Add `indexInSession` (dense integer, starts at 0) if not already present.

**Create:**
- `lib/sessions/fork.ts` — `forkSession(parentId, atMessageIndex)`:
  1. Copy `sessions` row → new id, same agentConfigId, same repoPath, set `parentSessionId` + `forkedAtMessageIndex`.
  2. Copy `session_messages` rows with `indexInSession <= atMessageIndex` into the new session.
  3. Do **not** copy the SDK `sdkSessionId` — a fork means a fresh SDK session, re-seeded from the copied transcript.

### Chunk 2 — Resume-from-transcript

The SDK supports `resume: sdkSessionId` but not "resume from an explicit message list we hand you". There are two paths:

- **(A)** Feed the copied transcript back as one big user message prefixed with "Here's the conversation so far:". Crude but reliable.
- **(B)** Use the SDK's internal persistence format if it's stable enough to write. Check `@anthropic-ai/claude-agent-sdk` docs for a supported way to seed a new session from messages.

**Default:** try (B); fall back to (A) if the SDK doesn't expose it. Either way, once the first turn runs, the new session has its own `sdkSessionId` and normal resume works from then on.

### Chunk 3 — UI

**Modify:**
- `app/sessions/[id]/message.tsx` — on hover of any assistant message, show a small "↯ Fork from here" button. Click → `POST /api/sessions/[id]/fork { atMessageIndex }` → redirect to new session.
- `app/sessions/[id]/page.tsx` — if `parentSessionId` set, show a small "← from <parent.title> @ turn N" breadcrumb at top.

**Create:**
- `app/api/sessions/[id]/fork/route.ts`.

---

## Out of scope

- **Auto-diff between siblings.** Comparing "session A got here, session B got there" is its own feature — don't tack it on.
- **3-way merging of forked work.** Pure fantasy for an agent session. If a fork produced good work, land *its* PR.
- **Copying worktrees on fork.** Each fork gets a fresh worktree when its agent run begins. Agents are idempotent enough that re-running against the same repo is fine.

---

## Open questions

- **SDK resume-from-transcript:** exact API. Check before committing to (A) vs (B).
- **Cost accounting on forks:** the copied messages don't cost — only the new turns do. Make sure `usage_events` doesn't double-count.
- **Artifact inheritance:** a fork's Results tab — does it inherit the parent's artifacts up to the fork point? Probably no: artifacts are tied to the session that produced them. Show a "see parent session for earlier artifacts" link instead.

---

## Success criteria

1. Fork button on any assistant message creates a new session, scoped to the same repo + agent.
2. The new session's transcript starts with the parent's messages through the fork point.
3. Sending a new prompt in the fork produces a working agent run that doesn't "remember" parent-session turns beyond the fork point.
4. Parent session is unchanged.
5. Breadcrumb links fork ↔ parent both ways.
