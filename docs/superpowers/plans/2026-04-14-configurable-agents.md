# Configurable Agents Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `pm / engineer / tester` trio with user-editable agent configurations — each with its own name, system prompt, model, allowed tools, budget, and project-settings scope — created and edited from the UI.

**Architecture:** New `agent_configs` Postgres table owned per user. Seeded with the existing three roles on first boot (idempotent). Sessions reference an agent config by FK. The old `role` column becomes derivable from `agent_configs.slug` and is removed. The in-process runner (`lib/agent/runner.ts`) and the Linear poller (`lib/linear/poller.ts`) both read from `agent_configs` instead of the hardcoded `lib/agent/roles.ts`.

**Tech Stack:** Next.js 15 app router, Drizzle ORM, Postgres, Claude Agent SDK 0.2.x, Zod, Tailwind v4.

---

## File Structure

**Create:**
- `lib/db/agent-configs.ts` — data access: list/get/create/update/delete + seed.
- `lib/agent/load-agent-config.ts` — resolve an `agentConfigId` to the shape the SDK `query()` needs.
- `app/agents/page.tsx` — list agents.
- `app/agents/agents-list.tsx` — client component with create/edit/delete actions.
- `app/agents/new/page.tsx` — new agent form.
- `app/agents/[id]/edit/page.tsx` — edit agent form.
- `app/agents/agent-form.tsx` — shared client form (create + edit).
- `app/api/agents/route.ts` — `GET` list, `POST` create.
- `app/api/agents/[id]/route.ts` — `GET`, `PATCH`, `DELETE`.
- `tests/agent-configs.test.ts` — data layer tests.
- `tests/agents-api.test.ts` — API route tests.

**Modify:**
- `lib/db/schema.ts` — add `agentConfigs` table, add `agentConfigId` FK on `sessions`, drop the `role` enum column after migration.
- `lib/auth/bootstrap.ts` — after `ensureAdminUser`, call `ensureBuiltInAgentConfigs(userId)`.
- `lib/agent/runner.ts` — replace `loadRoleByName(row.role)` with `loadAgentConfig(row.agentConfigId)`.
- `lib/linear/poller.ts` — replace the hardcoded role list with a DB query for agent configs tagged as "Linear-pickup".
- `app/sessions/new/new-session-form.tsx` — swap the three-role button group for an agent dropdown.
- `app/api/sessions/route.ts` — accept `agentConfigId` instead of `role`.
- `app/sessions/[id]/page.tsx` — display the agent name instead of `ROLE_LABEL[role]`.
- `app/page.tsx` — same display swap.
- `lib/agent/roles.ts` — delete after migration lands (or keep temporarily re-exporting seed data).

**Delete at the end:**
- `lib/agent/roles.ts`

---

## Chunk 1: Schema + data layer

### Task 1: Add `agentConfigs` table + FK on `sessions`

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add the new table and column**

In `lib/db/schema.ts`, after the `users` definition and before `sessions`, add:

```ts
export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Stable short identifier, kebab-case. Used by the Linear poller to
     *  match per-role env vars (PM_PICKUP_STATE etc.). Unique per user. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    model: text("model").notNull(),
    fallbackModel: text("fallback_model"),
    /** null = all built-in tools allowed */
    allowedTools: jsonb("allowed_tools").$type<string[] | null>(),
    /** empty array = none disallowed */
    disallowedTools: jsonb("disallowed_tools").$type<string[]>().notNull().default([]),
    /** When true, SDK reads .claude/settings.json skills from the repo */
    includeProjectSkills: integer("include_project_skills").notNull().default(1),
    maxTurns: integer("max_turns").notNull().default(100),
    effort: text("effort", { enum: ["low", "medium", "high", "max"] })
      .notNull()
      .default("high"),
    maxBudgetUsd: integer("max_budget_usd"),
    /** When true, this agent is picked up by the Linear poller. */
    linearPickup: integer("linear_pickup").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("agent_configs_user_slug_idx").on(t.userId, t.slug)],
);
```

Then in the existing `sessions` table, add:

```ts
agentConfigId: text("agent_config_id").references(() => agentConfigs.id, {
  onDelete: "set null",
}),
```

Do **not** remove the `role` column yet — we'll backfill first.

- [ ] **Step 2: Push schema**

Run: `bun run --cwd . db:push`
Expected: prompt confirming the new table, no errors. Answer "yes" for data-loss questions only if they're on the new empty columns.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): add agent_configs table + session FK"
```

---

### Task 2: Data-access layer

**Files:**
- Create: `lib/db/agent-configs.ts`
- Test: `tests/agent-configs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent-configs.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { agentConfigs, users } from "@/lib/db/schema";
import {
  createAgentConfig,
  deleteAgentConfig,
  getAgentConfig,
  listAgentConfigs,
  updateAgentConfig,
  ensureBuiltInAgentConfigs,
} from "@/lib/db/agent-configs";

const userId = "test-user-" + nanoid();

beforeEach(async () => {
  await db.delete(agentConfigs).where(eq(agentConfigs.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({
    id: userId,
    email: `${userId}@test.local`,
    passwordHash: "scrypt$1$1$1$00$00",
  });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe("agent-configs", () => {
  test("create + list + get round-trip", async () => {
    const created = await createAgentConfig({
      userId,
      slug: "my-agent",
      name: "My Agent",
      systemPrompt: "You are helpful.",
      model: "claude-opus-4-6",
      maxTurns: 10,
    });
    const fetched = await getAgentConfig(userId, created.id);
    expect(fetched?.name).toBe("My Agent");
    const all = await listAgentConfigs(userId);
    expect(all).toHaveLength(1);
  });

  test("slug is unique per user", async () => {
    await createAgentConfig({
      userId, slug: "dup", name: "A",
      systemPrompt: "x", model: "claude-opus-4-6", maxTurns: 10,
    });
    await expect(
      createAgentConfig({
        userId, slug: "dup", name: "B",
        systemPrompt: "x", model: "claude-opus-4-6", maxTurns: 10,
      }),
    ).rejects.toThrow();
  });

  test("ensureBuiltInAgentConfigs is idempotent", async () => {
    await ensureBuiltInAgentConfigs(userId);
    const first = await listAgentConfigs(userId);
    await ensureBuiltInAgentConfigs(userId);
    const second = await listAgentConfigs(userId);
    expect(first.length).toBe(3);
    expect(second.length).toBe(3);
  });

  test("update changes fields but not slug", async () => {
    const c = await createAgentConfig({
      userId, slug: "x", name: "A",
      systemPrompt: "x", model: "claude-opus-4-6", maxTurns: 10,
    });
    const updated = await updateAgentConfig(userId, c.id, { name: "B" });
    expect(updated?.name).toBe("B");
    expect(updated?.slug).toBe("x");
  });

  test("delete removes the row", async () => {
    const c = await createAgentConfig({
      userId, slug: "del", name: "A",
      systemPrompt: "x", model: "claude-opus-4-6", maxTurns: 10,
    });
    await deleteAgentConfig(userId, c.id);
    expect(await getAgentConfig(userId, c.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/agent-configs.test.ts`
Expected: FAIL — `Module not found '@/lib/db/agent-configs'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/db/agent-configs.ts`:

```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { agentConfigs } from "./schema";

export type AgentConfig = typeof agentConfigs.$inferSelect;
type NewAgentConfig = typeof agentConfigs.$inferInsert;

export async function listAgentConfigs(userId: string): Promise<AgentConfig[]> {
  return db.select().from(agentConfigs).where(eq(agentConfigs.userId, userId));
}

export async function getAgentConfig(
  userId: string,
  id: string,
): Promise<AgentConfig | null> {
  const rows = await db
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.userId, userId), eq(agentConfigs.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAgentConfigBySlug(
  userId: string,
  slug: string,
): Promise<AgentConfig | null> {
  const rows = await db
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.userId, userId), eq(agentConfigs.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAgentConfig(
  input: Omit<NewAgentConfig, "id" | "createdAt" | "updatedAt">,
): Promise<AgentConfig> {
  const id = nanoid();
  const [row] = await db
    .insert(agentConfigs)
    .values({ ...input, id })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updateAgentConfig(
  userId: string,
  id: string,
  patch: Partial<
    Omit<NewAgentConfig, "id" | "userId" | "slug" | "createdAt">
  >,
): Promise<AgentConfig | null> {
  const [row] = await db
    .update(agentConfigs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(agentConfigs.userId, userId), eq(agentConfigs.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteAgentConfig(
  userId: string,
  id: string,
): Promise<void> {
  await db
    .delete(agentConfigs)
    .where(and(eq(agentConfigs.userId, userId), eq(agentConfigs.id, id)));
}

const BUILT_INS: Array<Omit<NewAgentConfig, "id" | "userId" | "createdAt" | "updatedAt">> = [
  {
    slug: "pm",
    name: "PM",
    systemPrompt:
      "You are an autonomous product manager. Turn requests into crisp specs: goals, non-goals, acceptance criteria, edge cases, and a prioritized plan. Ask one clarifying question only if truly blocked.",
    model: "claude-opus-4-6",
    fallbackModel: "claude-sonnet-4-6",
    maxTurns: 30,
    effort: "high",
    maxBudgetUsd: 5,
    linearPickup: 1,
  },
  {
    slug: "engineer",
    name: "Engineer",
    systemPrompt:
      "You are an autonomous software engineer. Plan briefly, then implement. Use Read/Edit/Bash to explore and modify. Verify with build/tests. Conventional commits. No debug logs.",
    model: "claude-opus-4-6",
    fallbackModel: "claude-sonnet-4-6",
    maxTurns: 200,
    effort: "high",
    maxBudgetUsd: 15,
    linearPickup: 1,
  },
  {
    slug: "tester",
    name: "QA",
    systemPrompt:
      "You are an autonomous QA engineer. Design and run tests. Report pass/fail/flaky with evidence. Do not modify production code.",
    model: "claude-sonnet-4-6",
    fallbackModel: "claude-haiku-4-5-20251001",
    maxTurns: 60,
    effort: "medium",
    maxBudgetUsd: 5,
    linearPickup: 1,
  },
];

export async function ensureBuiltInAgentConfigs(userId: string): Promise<void> {
  for (const b of BUILT_INS) {
    const existing = await getAgentConfigBySlug(userId, b.slug);
    if (!existing) {
      await createAgentConfig({ ...b, userId });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/agent-configs.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/db/agent-configs.ts tests/agent-configs.test.ts
git commit -m "feat(db): agent-configs data layer + built-in seed"
```

---

### Task 3: Bootstrap built-ins on first boot

**Files:**
- Modify: `lib/auth/bootstrap.ts:ensureAdminUser`

- [ ] **Step 1: Patch bootstrap**

In `lib/auth/bootstrap.ts`, after the `db.insert(users)...` call, import and call the seeder:

```ts
import { ensureBuiltInAgentConfigs } from "@/lib/db/agent-configs";

// ...inside ensureAdminUser, after inserting the user:
const [row] = await db
  .insert(users)
  .values({ /* ... */ })
  .returning({ id: users.id });
if (row) await ensureBuiltInAgentConfigs(row.id);
```

Also, on subsequent boots (user already exists), still call `ensureBuiltInAgentConfigs(existing[0].id)` so newer built-ins get added over time.

- [ ] **Step 2: Manual verification**

Drop the `agent_configs` rows if any exist, restart `bun run dev`, then run in `psql`:

```sql
SELECT slug, name, model FROM agent_configs;
```

Expected: 3 rows (`pm`, `engineer`, `tester`).

- [ ] **Step 3: Commit**

```bash
git add lib/auth/bootstrap.ts
git commit -m "feat(auth): seed built-in agents on first boot"
```

---

## Chunk 2: Load config in the runner

### Task 4: `loadAgentConfig()` — map a config row to SDK options

**Files:**
- Create: `lib/agent/load-agent-config.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/load-agent-config.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildSdkOptionsFromConfig } from "@/lib/agent/load-agent-config";

const base = {
  id: "a1", userId: "u1", slug: "engineer", name: "Engineer",
  systemPrompt: "You ship.", model: "claude-opus-4-6",
  fallbackModel: "claude-sonnet-4-6",
  allowedTools: null, disallowedTools: [],
  includeProjectSkills: 1, maxTurns: 200, effort: "high" as const,
  maxBudgetUsd: 15, linearPickup: 1,
  createdAt: new Date(), updatedAt: new Date(),
};

describe("buildSdkOptionsFromConfig", () => {
  test("passes systemPrompt, model, fallbackModel", () => {
    const o = buildSdkOptionsFromConfig(base, "/repo");
    expect(o.model).toBe("claude-opus-4-6");
    expect(o.fallbackModel).toBe("claude-sonnet-4-6");
    expect(o.systemPrompt).toBe("You ship.");
  });

  test("omits allowedTools when null", () => {
    const o = buildSdkOptionsFromConfig(base, "/repo");
    expect("allowedTools" in o).toBe(false);
  });

  test("sets settingSources to ['project'] when includeProjectSkills", () => {
    const o = buildSdkOptionsFromConfig(base, "/repo");
    expect(o.settingSources).toEqual(["project"]);
  });

  test("settingSources empty array when project skills off", () => {
    const o = buildSdkOptionsFromConfig(
      { ...base, includeProjectSkills: 0 },
      "/repo",
    );
    expect(o.settingSources).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/load-agent-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/agent/load-agent-config.ts`:

```ts
import "server-only";
import type { AgentConfig } from "@/lib/db/agent-configs";

export interface BuiltSdkOptions {
  model: string;
  fallbackModel?: string;
  cwd: string;
  permissionMode: "bypassPermissions";
  allowDangerouslySkipPermissions: true;
  systemPrompt: string;
  maxTurns: number;
  effort: "low" | "medium" | "high" | "max";
  settingSources: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  maxBudgetUsd?: number;
}

export function buildSdkOptionsFromConfig(
  c: AgentConfig,
  cwd: string,
): BuiltSdkOptions {
  const opts: BuiltSdkOptions = {
    model: c.model,
    cwd,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    systemPrompt: c.systemPrompt,
    maxTurns: c.maxTurns,
    effort: c.effort,
    settingSources: c.includeProjectSkills ? ["project"] : [],
  };
  if (c.fallbackModel) opts.fallbackModel = c.fallbackModel;
  if (c.allowedTools && c.allowedTools.length > 0)
    opts.allowedTools = c.allowedTools;
  if (c.disallowedTools.length > 0) opts.disallowedTools = c.disallowedTools;
  if (c.maxBudgetUsd !== null && c.maxBudgetUsd !== undefined)
    opts.maxBudgetUsd = c.maxBudgetUsd;
  return opts;
}
```

- [ ] **Step 4: Run test**

Run: `bun test tests/load-agent-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/load-agent-config.ts tests/load-agent-config.test.ts
git commit -m "feat(agent): buildSdkOptionsFromConfig helper"
```

---

### Task 5: Swap `runner.ts` over to agent configs

**Files:**
- Modify: `lib/agent/runner.ts`

- [ ] **Step 1: Switch the config load**

Replace the block that loads `loadRoleByName(row.role)` and builds `options` with a call to `getAgentConfig(userId, row.agentConfigId)` + `buildSdkOptionsFromConfig(config, row.repoPath)`. Also merge in the runner-owned fields (`executable`, `pathToClaudeCodeExecutable`, `resume`, `stderr` handler).

- [ ] **Step 2: Fallback**

If `row.agentConfigId` is null (legacy sessions, or the config was deleted), look up by slug matching the old `row.role` value. Log a warning. Return early with a helpful error message persisted to the session if both lookups fail.

- [ ] **Step 3: Manual verification**

Start a UI session using any role. Tail the dev server log — expect `[runner] spawning agent: executable=... cli=...`. Agent should respond normally.

- [ ] **Step 4: Commit**

```bash
git add lib/agent/runner.ts
git commit -m "refactor(agent): load agent config from DB"
```

---

## Chunk 3: API + UI for editing agents

### Task 6: API routes

**Files:**
- Create: `app/api/agents/route.ts`
- Create: `app/api/agents/[id]/route.ts`

- [ ] **Step 1: `GET` list + `POST` create**

Create `app/api/agents/route.ts` with `GET` (list the signed-in user's configs) and `POST` (validate with Zod, call `createAgentConfig`). Zod schema:

```ts
const createSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(40),
  name: z.string().min(1).max(80),
  systemPrompt: z.string().min(1).max(10_000),
  model: z.string().min(1),
  fallbackModel: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).optional(),
  includeProjectSkills: z.boolean().default(true),
  maxTurns: z.number().int().min(1).max(1000).default(100),
  effort: z.enum(["low", "medium", "high", "max"]).default("high"),
  maxBudgetUsd: z.number().int().positive().nullable().optional(),
  linearPickup: z.boolean().default(false),
});
```

Convert `boolean` to `0/1` before inserting (integer column).

- [ ] **Step 2: `GET` / `PATCH` / `DELETE` by id**

Create `app/api/agents/[id]/route.ts`. Re-derive Zod schema as `createSchema.partial()` for `PATCH`. 404 on missing, 401 if unauthenticated.

- [ ] **Step 3: Tests**

Create `tests/agents-api.test.ts` (POST happy path, POST 400 on bad slug, GET list, PATCH, DELETE, 401 without session). Use direct HTTP requests against `bun run dev` in a `beforeAll` hook, or call the route handlers directly with a mocked `NextRequest`.

- [ ] **Step 4: Commit**

```bash
git add app/api/agents tests/agents-api.test.ts
git commit -m "feat(api): agent CRUD routes"
```

---

### Task 7: UI — agents list + editor

**Files:**
- Create: `app/agents/page.tsx`
- Create: `app/agents/agents-list.tsx`
- Create: `app/agents/new/page.tsx`
- Create: `app/agents/[id]/edit/page.tsx`
- Create: `app/agents/agent-form.tsx`
- Modify: `app/page.tsx` (add "Agents" link in header)

- [ ] **Step 1: List page**

Server component that fetches `listAgentConfigs(session.userId)` and renders a table: Name, Slug, Model, Max turns, Max budget, Linear pickup (badge), Actions (Edit, Delete). Match the styling of `app/page.tsx`.

- [ ] **Step 2: `AgentForm` shared client**

Inputs for every field on `AgentConfig`. Key widgets:
- **Tool picker** — checkbox list of SDK built-in tools (`Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Task`, `TodoWrite`). Mode toggle: "All" vs "Only selected". When "All", the payload is `{ allowedTools: null }`.
- **Skills scope** — single toggle: "Use repo's `.claude/settings.json`". On = `includeProjectSkills: true`.
- **Linear pickup** — checkbox: "This agent can be assigned Linear tickets by the poller."
- **Effort** — dropdown.
- **Budget** — number input (USD), blank = no cap.
- **Model** + **fallback** — plain text inputs (no dropdown yet — model list is volatile).

- [ ] **Step 3: New + edit pages**

`/agents/new` mounts `<AgentForm mode="create" />`, `/agents/[id]/edit` fetches the config and mounts `<AgentForm mode="edit" initial={config} />`. Submit posts to the API routes and redirects to `/agents`.

- [ ] **Step 4: Header link**

On the sessions list page (`app/page.tsx`), add a small `Agents` link next to the `New` button.

- [ ] **Step 5: Manual verification**

Boot `bun run dev`, log in, visit `/agents` — see the three seeded configs. Click Edit on Engineer, change the system prompt, save. Reload — change persists. Create a new agent "Docs Writer" with `model: claude-sonnet-4-6`, `effort: low`, `linearPickup: false`. Delete it. Confirm gone.

- [ ] **Step 6: Commit**

```bash
git add app/agents
git commit -m "feat(ui): agent configs pages"
```

---

## Chunk 4: Sessions reference agent configs

### Task 8: Session create form uses agent dropdown

**Files:**
- Modify: `app/sessions/new/page.tsx`
- Modify: `app/sessions/new/new-session-form.tsx`
- Modify: `app/api/sessions/route.ts`

- [ ] **Step 1: Fetch agent list on page**

In `app/sessions/new/page.tsx`, load `listAgentConfigs(session.userId)` and pass as a prop to the form.

- [ ] **Step 2: Replace role picker**

In `new-session-form.tsx`, swap the three-button group for a `<select>` of agent configs (value = id, label = name + small slug). Submit `agentConfigId` instead of `role`.

- [ ] **Step 3: API accepts agentConfigId**

`POST /api/sessions` schema becomes:

```ts
agentConfigId: z.string().min(1),
title: z.string().min(1).max(200),
repoLabel: z.string().nullable().optional(),
repoPath: z.string().min(1),
firstMessage: z.string().min(1),
```

On insert, set `agentConfigId`. Temporarily also set `role` by reading the referenced config's `slug` (so legacy code paths keep working). Reject the call if the referenced config doesn't belong to the signed-in user.

- [ ] **Step 4: Display name on sessions list + detail**

In `app/page.tsx` and `app/sessions/[id]/page.tsx`, join against `agentConfigs` and render `agentConfig.name` in place of `ROLE_LABEL[row.role]`.

- [ ] **Step 5: Manual verification**

Create a session → select Engineer → start → works. Create a custom "Docs Writer" agent → start a session with it → works. Session list shows the agent name.

- [ ] **Step 6: Commit**

```bash
git add app/sessions app/api/sessions app/page.tsx
git commit -m "feat(sessions): reference agent configs"
```

---

### Task 9: Linear poller uses `linearPickup` agents

**Files:**
- Modify: `lib/linear/poller.ts`

- [ ] **Step 1: Query DB instead of env**

Replace `loadRoleConfigs()` (env-driven) with a DB query: `listAgentConfigs(userId)` filtered by `linearPickup: 1`. For each, keep the env-driven state mapping (`<SLUG>_PICKUP_STATE`, `<SLUG>_IN_PROGRESS_STATE`). If the env var isn't set, skip that agent with a console warning.

- [ ] **Step 2: Create session with `agentConfigId`**

In the `db.insert(sessions)` call, set `agentConfigId: cfg.id` (instead of `role`).

- [ ] **Step 3: Manual verification**

Label a test Linear ticket with `agent` + one of your repo labels, move it to your engineer pickup state. Within 2 minutes, a new session should appear in the UI with the engineer agent bound to it. Delete the ticket after.

- [ ] **Step 4: Commit**

```bash
git add lib/linear/poller.ts
git commit -m "feat(linear): poller uses DB agent configs"
```

---

## Chunk 5: Cleanup

### Task 10: Drop the `role` column

**Files:**
- Modify: `lib/db/schema.ts`
- Delete: `lib/agent/roles.ts`

- [ ] **Step 1: Backfill any legacy rows**

```sql
-- Safety — should be a no-op by now
UPDATE sessions SET agent_config_id = (
  SELECT id FROM agent_configs
  WHERE agent_configs.user_id = sessions.user_id
    AND agent_configs.slug = sessions.role
)
WHERE agent_config_id IS NULL;
```

Run from `bun run --cwd . db:studio` or psql. Verify no nulls remain:

```sql
SELECT COUNT(*) FROM sessions WHERE agent_config_id IS NULL;
```

Expected: `0`. If nonzero, investigate before dropping the column.

- [ ] **Step 2: Remove `role` from schema**

Delete the `role` column from `sessions` in `lib/db/schema.ts`. Make `agentConfigId` `.notNull()`.

- [ ] **Step 3: Push schema**

Run: `bun run --cwd . db:push`
Answer "yes" when prompted about dropping the column.

- [ ] **Step 4: Delete `lib/agent/roles.ts`**

```bash
git rm lib/agent/roles.ts
```

Update any stragglers — grep for `loadRoleByName` and `UiRoleConfig` to confirm nothing else imports them.

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: all tests pass. Smoke-test the UI: create session, delete session, create agent, edit agent.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "refactor: drop hardcoded roles"
```

---

## Chunk 6: Docs

### Task 11: Document the new UX

**Files:**
- Modify: `docs/ROADMAP.md` (mark M2 as shipped)
- Create: `docs/AGENTS.md`

- [ ] **Step 1: `docs/AGENTS.md`**

Short doc explaining: how to create an agent, what each field does, how the tool picker maps to SDK built-ins, how `linearPickup` interacts with `<SLUG>_PICKUP_STATE` env vars. Include a screenshot or two of the UI.

- [ ] **Step 2: Update roadmap**

In `docs/ROADMAP.md`, move M2 from "next" to "shipped" and promote M3 (MCP tools) or M4 (deploy) to "next" based on user priority.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: configurable agents shipped"
```

---

## Out of scope for this plan

- **Tool *approval* flow** — that's M6. This plan only lets you *pick* which tools an agent has; it doesn't gate individual calls behind a UI approval.
- **MCP tool picker** — adding Linear/GitHub MCP tools to an agent config is M3.
- **Cross-user agent sharing** — agents are per-user. Sharing waits for M8.
- **Validating models against a live list** — model IDs are free-text for now. Could add a `GET /api/models` later.

---

## Success criteria

This plan is done when:

1. The Agents page lists your three seeded agents on a fresh boot.
2. You can create a new agent via the UI and use it to start a session.
3. You can edit an agent's system prompt, model, tools — and the change takes effect on the next session.
4. A Linear ticket tagged for a `linearPickup: true` agent creates a session bound to that agent's config.
5. `lib/agent/roles.ts` is deleted; grep turns up no references.
6. `bun test` passes end-to-end.
