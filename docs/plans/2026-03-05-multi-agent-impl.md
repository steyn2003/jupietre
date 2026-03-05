# Multi-Agent System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a 3-agent system (PM/Engineer/Tester) that coordinates through Linear ticket states, running in Docker via the Claude Agent SDK.

**Architecture:** Single TypeScript codebase, one Docker image, three containers differentiated by `AGENT_ROLE` env var. Each role has its own model, system prompt, tool set, and poller filter. Agents communicate exclusively via Linear comments.

**Tech Stack:** TypeScript, @anthropic-ai/claude-agent-sdk, @linear/sdk, zod, Docker

---

### Task 1: Add `linear_create_issue` tool

**Files:**
- Modify: `src/tools/linear.ts`

**Step 1: Add the tool export after `linearAddComment`**

Add this after line 91 in `src/tools/linear.ts`:

```typescript
export const linearCreateIssue = tool(
  "linear_create_issue",
  "Create a new Linear issue, optionally as a sub-issue of a parent.",
  {
    title: z.string().describe("Issue title"),
    description: z.string().describe("Issue description in markdown"),
    teamKey: z.string().describe("Team key, e.g. 'ENG'"),
    parentId: z.string().optional().describe("Parent issue ID to create as sub-issue"),
    labelNames: z.array(z.string()).optional().describe("Label names to apply"),
  },
  async ({ title, description, teamKey, parentId, labelNames }) => {
    const client = getClient();
    const teams = await client.teams({ filter: { key: { eq: teamKey } } });
    const team = teams.nodes[0];
    if (!team) throw new Error(`Team '${teamKey}' not found`);

    let labelIds: string[] | undefined;
    if (labelNames?.length) {
      const labels = await team.labels();
      labelIds = labels.nodes
        .filter((l) => labelNames.some((n) => n.toLowerCase() === l.name.toLowerCase()))
        .map((l) => l.id);
    }

    const result = await client.createIssue({
      title,
      description,
      teamId: team.id,
      parentId,
      labelIds,
    });
    const issue = await result.issue;
    return {
      content: [{ type: "text" as const, text: `Created ${issue?.identifier}: ${issue?.title}` }],
    };
  },
);
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tools/linear.ts
git commit -m "feat: add linear_create_issue tool for sub-ticket creation"
```

---

### Task 2: Add `gh_pr_review` tool

**Files:**
- Modify: `src/tools/github.ts`

**Step 1: Add the tool export after `gitCleanupWorktree`**

Add this after line 77 in `src/tools/github.ts`:

```typescript
export const ghPrReview = tool(
  "gh_pr_review",
  "Approve or request changes on a GitHub pull request.",
  {
    prNumber: z.number().describe("PR number"),
    action: z.enum(["approve", "request-changes"]).describe("Review action"),
    body: z.string().describe("Review comment body in markdown"),
  },
  async ({ prNumber, action, body }) => {
    const flag = action === "approve" ? "--approve" : "--request-changes";
    const result = await run("gh", ["pr", "review", String(prNumber), flag, "--body", body]);
    return { content: [{ type: "text" as const, text: result || `PR #${prNumber} reviewed (${action})` }] };
  },
);
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tools/github.ts
git commit -m "feat: add gh_pr_review tool for PR approvals and change requests"
```

---

### Task 3: Update `agent.ts` to support per-role model config

**Files:**
- Modify: `src/roles/index.ts`
- Modify: `src/agent.ts`

**Step 1: Add `model` and `devAgentModel` fields to `RoleConfig`**

In `src/roles/index.ts`, add two fields to the `RoleConfig` interface after `maxTurns`:

```typescript
  /** Model to use for this role's main agent */
  model: string;
  /** Model to use for the dev-agent subagent (if hasDevAgent) */
  devAgentModel?: string;
```

**Step 2: Update `agent.ts` to use role model config**

In `src/agent.ts`, remove the hardcoded `const MODEL = "claude-sonnet-4-6";` (line 4) and update the `invokeAgent` function:

- Change `model: MODEL` (line 52) to `model: role.model`
- Change `model: "sonnet"` (line 44) to `model: role.devAgentModel ?? "opus"`

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Errors about missing `model` field on existing roles (expected — we fix in next tasks)

**Step 4: Commit**

```bash
git add src/roles/index.ts src/agent.ts
git commit -m "feat: support per-role model configuration"
```

---

### Task 4: Create PM role (Juno)

**Files:**
- Create: `src/roles/pm.ts`

**Step 1: Create the PM role file**

```typescript
import type { RoleConfig } from "./index.js";
import {
  linearGetIssue,
  linearUpdateIssueState,
  linearAddComment,
  linearCreateIssue,
} from "../tools/linear.js";

export const role: RoleConfig = {
  name: "pm",
  displayName: "Juno",
  systemPrompt: `You are Juno, an autonomous project manager. You are organized, proactive, and calm under pressure. You keep the wheels turning.

Your job is to take raw tickets from Backlog, prep them for the engineering agent (Titus), and hand them off ready to implement.

## Your Workflow

When assigned a ticket:

1. **Read the ticket** — Use linear_get_issue to read the full description, comments, and labels.

2. **Size check** — A well-sized ticket is completable in a single focused coding session. If the ticket is too large (touches 3+ unrelated modules, has multiple distinct deliverables, or says "refactor entire" / "migrate all"), split it into sub-issues using linear_create_issue. Each sub-issue must be independently mergeable.

3. **Route by labels:**
   - **Bug** — Focus on reproduction steps and expected vs actual behavior.
   - **Research Needed** — Research the topic thoroughly, then update the ticket description with findings. Do NOT assign to Titus — leave for the human.
   - **Plan** — Full prep: research, context, coding prompt.
   - **(default)** — Standard prep flow.

4. **Research** — For any external APIs, SDKs, or services the ticket involves, document: key endpoints/methods, authentication requirements, rate limits, and gotchas. Add a "Research Notes" section to the ticket description.

5. **Context enrichment** — Update the ticket description with:
   - Relevant file paths the engineer should modify
   - Key function/component names to look at
   - Related code patterns to follow
   - Edge cases
   - Definition of Done (checkboxes with verifiable conditions)
   - Test cases (concrete input/output scenarios)

6. **Coding prompt** — Add a 1-2 sentence prompt for the coding agent at the bottom of the description. Formula: [Action verb] [specific thing] in [specific location], [following pattern/constraint].

7. **Assign to Titus** — Update the ticket state to "In Development" using linear_update_issue_state. Post a comment summarizing what was prepped.

## Rules
- Do NOT ask questions — make reasonable decisions and proceed.
- Always append to the ticket description, never overwrite existing content.
- Each sub-issue must be independently mergeable.
- If a ticket is just a question/discussion, respond via comment and do not assign.
- When splitting into sub-tickets, order them: dependencies first, foundation before features, backend before frontend, risks/unknowns early, smallest unblocking unit first.`,

  tools: [
    linearGetIssue,
    linearUpdateIssueState,
    linearAddComment,
    linearCreateIssue,
  ],

  pollerFilter: {
    label: "agent",
    stateName: "Backlog",
  },
  inProgressState: "In Progress",
  doneState: "In Development",
  hasDevAgent: false,
  maxTurns: 20,
  model: "claude-opus-4-6",
};
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors for this file (may still have errors from engineer/qa missing `model`)

**Step 3: Commit**

```bash
git add src/roles/pm.ts
git commit -m "feat: add Juno PM role with ticket prep workflow"
```

---

### Task 5: Update Engineer role (Titus)

**Files:**
- Modify: `src/roles/engineer.ts`

**Step 1: Rewrite the engineer role with enriched system prompt and model config**

Replace the entire content of `src/roles/engineer.ts`:

```typescript
import type { RoleConfig } from "./index.js";
import {
  gitCreateWorktree,
  gitPushBranch,
  ghCreatePR,
  gitCleanupWorktree,
} from "../tools/github.js";
import {
  linearGetIssue,
  linearUpdateIssueState,
  linearAddComment,
} from "../tools/linear.js";

export const role: RoleConfig = {
  name: "engineer",
  displayName: "Titus",
  systemPrompt: `You are Titus, an autonomous software engineer. You are competent, direct, and low-ego. You ship.

Code is your craft. You take pride in clean, maintainable solutions. "Working" is table stakes — good code is readable, testable, and doesn't surprise the next person.

## Your Workflow

When assigned a ticket:

1. **Read the ticket** — Use linear_get_issue to read the full description, comments, acceptance criteria, and coding prompt. Understand the Definition of Done before writing a line of code.

2. **Create a worktree** — Use git_create_worktree with branch name \`agent/<issue-identifier>\` (e.g. \`agent/ENG-123\`).

3. **Delegate to dev-agent** — Spawn the dev-agent subagent with a clear prompt including:
   - The goal from the ticket
   - Relevant file paths and function names from the ticket description
   - Acceptance criteria
   - What NOT to touch
   - The worktree path to work in

4. **Verify** — After dev-agent completes, check its output. If it failed or missed requirements, give targeted follow-up — don't repeat the whole task. If it's going in circles, re-approach differently.

5. **Ship it** — Push the branch with git_push_branch, create a PR with gh_create_pr referencing the Linear issue.

6. **Hand off** — Post the PR link as a comment on the Linear issue using linear_add_comment. Move the ticket to "In Review" using linear_update_issue_state.

7. **Clean up** — Remove the worktree with git_cleanup_worktree.

## On Failure
- If dev-agent fails, retry once with targeted feedback.
- If it fails again, create a draft PR with a failure summary. Post a comment on the Linear issue explaining what went wrong. Still move to "In Review" so Scout can assess.

## Rules
- Do NOT ask questions — make reasonable decisions and proceed.
- Always create a PR, even for small changes.
- One PR per ticket. Keep PRs small and focused.
- Write clear PR descriptions referencing the Linear issue.
- No debug logs, commented-out code, or unrelated changes in PRs.
- Commit with descriptive messages using conventional commits.`,

  tools: [
    gitCreateWorktree,
    gitPushBranch,
    ghCreatePR,
    gitCleanupWorktree,
    linearGetIssue,
    linearUpdateIssueState,
    linearAddComment,
  ],

  pollerFilter: {
    label: "agent",
    stateName: "In Development",
  },
  inProgressState: "In Development",
  doneState: "In Review",
  hasDevAgent: true,
  maxTurns: 30,
  model: "claude-sonnet-4-6",
  devAgentModel: "opus",
};
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors for this file

**Step 3: Commit**

```bash
git add src/roles/engineer.ts
git commit -m "feat: enrich Titus engineer role with soul/identity and model config"
```

---

### Task 6: Update Tester role (Scout)

**Files:**
- Modify: `src/roles/qa.ts`

**Step 1: Rewrite the QA role with enriched system prompt, gh_pr_review tool, and model config**

Replace the entire content of `src/roles/qa.ts`:

```typescript
import type { RoleConfig } from "./index.js";
import {
  gitCreateWorktree,
  gitCleanupWorktree,
  ghPrReview,
} from "../tools/github.js";
import {
  linearGetIssue,
  linearUpdateIssueState,
  linearAddComment,
} from "../tools/linear.js";

export const role: RoleConfig = {
  name: "tester",
  displayName: "Scout",
  systemPrompt: `You are Scout, an autonomous QA engineer. You are thorough, skeptical, and detail-oriented. You find the bugs others miss.

Quality is your obsession. You think like a user, an attacker, and a chaos monkey simultaneously. "It works on my machine" is your nemesis.

## Your Workflow

When assigned a ticket for review:

1. **Read the ticket** — Use linear_get_issue to read the full description, acceptance criteria, Definition of Done, and test cases. Find the PR link in the comments.

2. **Checkout the PR** — Use git_create_worktree to check out the PR branch.

3. **Review against acceptance criteria** — Check the code diff against every item in the Definition of Done:
   - Does the code match the ticket requirements?
   - Are there obvious bugs or edge cases?
   - Are there security concerns?
   - Is there test coverage for the changes?
   - No scope creep — only changes relevant to the ticket
   - No junk — no debug logs, commented-out code, leftover TODOs

4. **Run build and tests** — Auto-detect the package manager, then run install, build, and test commands.

5. **Decide:**
   - **All good** — Use gh_pr_review to approve the PR. Post a confirmation comment on the Linear issue. Move ticket to "Done".
   - **Minor test failures** — Spawn dev-agent to apply a minimal fix, commit, push, and re-run tests once. If still failing, request changes.
   - **Requirements not met** — Use gh_pr_review to request changes with specific gaps listed. Post a comment on the Linear issue noting what's missing. Move ticket back to "In Development".

6. **Clean up** — Remove the worktree with git_cleanup_worktree.

## Rules
- Do NOT ask questions — make reasonable decisions and proceed.
- Be specific in feedback — reference file names, line numbers, and exact issues.
- Don't fix issues yourself beyond minimal test fixes — send it back with clear feedback.
- If requirements are ambiguous, flag it rather than guessing whether it passes.
- A PR that "works" but doesn't match ticket requirements is not a pass.`,

  tools: [
    gitCreateWorktree,
    gitCleanupWorktree,
    ghPrReview,
    linearGetIssue,
    linearUpdateIssueState,
    linearAddComment,
  ],

  pollerFilter: {
    label: "agent",
    stateName: "In Review",
  },
  inProgressState: "In Review",
  doneState: "Done",
  hasDevAgent: true,
  maxTurns: 20,
  model: "claude-opus-4-6",
  devAgentModel: "opus",
};
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/roles/qa.ts
git commit -m "feat: enrich Scout tester role with soul/identity, gh_pr_review, and model config"
```

---

### Task 7: Register PM role in index and update role name mapping

**Files:**
- Modify: `src/roles/index.ts`

**Step 1: Import PM role and add to roles map, also map "tester" key**

Replace the entire content of `src/roles/index.ts`:

```typescript
import { role as pmRole } from "./pm.js";
import { role as engineerRole } from "./engineer.js";
import { role as testerRole } from "./qa.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface RoleConfig {
  name: string;
  displayName: string;
  systemPrompt: string;
  tools: any[];
  /** Linear issue filter for the poller */
  pollerFilter: {
    /** Only pick up issues with this label (undefined = no label check) */
    label?: string;
    /** Pick up issues in this workflow state name */
    stateName: string;
  };
  /** State to move issue to when work begins */
  inProgressState: string;
  /** State to move issue to when work is complete */
  doneState: string;
  /** Whether this role has the dev-agent subagent */
  hasDevAgent: boolean;
  /** Max turns for the agent session */
  maxTurns: number;
  /** Model to use for this role's main agent */
  model: string;
  /** Model to use for the dev-agent subagent (if hasDevAgent) */
  devAgentModel?: string;
}

const roles: Record<string, RoleConfig> = {
  pm: pmRole,
  engineer: engineerRole,
  tester: testerRole,
};

export function loadRole(): RoleConfig {
  const name = process.env.AGENT_ROLE ?? "engineer";
  const role = roles[name];
  if (!role) throw new Error(`Unknown AGENT_ROLE: ${name}. Available: ${Object.keys(roles).join(", ")}`);
  return role;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/roles/index.ts
git commit -m "feat: register PM role and add model fields to RoleConfig"
```

---

### Task 8: Update `docker-compose.yml` and `.env.example`

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Step 1: Replace docker-compose.yml**

```yaml
services:
  pm:
    build: .
    container_name: agent-pm
    restart: unless-stopped
    environment:
      AGENT_ROLE: pm
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      LINEAR_API_KEY: ${LINEAR_API_KEY}
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      GH_TOKEN: ${GITHUB_TOKEN}
      REPO_DIR: /data/repo
      POLL_INTERVAL_MS: ${POLL_INTERVAL_MS:-120000}
      LANGFUSE_PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY:-}
      LANGFUSE_SECRET_KEY: ${LANGFUSE_SECRET_KEY:-}
      LANGFUSE_BASE_URL: ${LANGFUSE_BASE_URL:-}
    volumes:
      - repo-data:/data

  engineer:
    build: .
    container_name: agent-engineer
    restart: unless-stopped
    environment:
      AGENT_ROLE: engineer
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      LINEAR_API_KEY: ${LINEAR_API_KEY}
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      GH_TOKEN: ${GITHUB_TOKEN}
      REPO_DIR: /data/repo
      POLL_INTERVAL_MS: ${POLL_INTERVAL_MS:-120000}
      LANGFUSE_PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY:-}
      LANGFUSE_SECRET_KEY: ${LANGFUSE_SECRET_KEY:-}
      LANGFUSE_BASE_URL: ${LANGFUSE_BASE_URL:-}
    volumes:
      - repo-data:/data

  tester:
    build: .
    container_name: agent-tester
    restart: unless-stopped
    environment:
      AGENT_ROLE: tester
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      LINEAR_API_KEY: ${LINEAR_API_KEY}
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      GH_TOKEN: ${GITHUB_TOKEN}
      REPO_DIR: /data/repo
      POLL_INTERVAL_MS: ${POLL_INTERVAL_MS:-120000}
      LANGFUSE_PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY:-}
      LANGFUSE_SECRET_KEY: ${LANGFUSE_SECRET_KEY:-}
      LANGFUSE_BASE_URL: ${LANGFUSE_BASE_URL:-}
    volumes:
      - repo-data:/data

volumes:
  repo-data:
```

**Step 2: Replace .env.example**

```
ANTHROPIC_API_KEY=
LINEAR_API_KEY=
GITHUB_TOKEN=
POLL_INTERVAL_MS=120000

# Langfuse tracing (optional)
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=
```

**Step 3: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat: add PM container and update docker-compose for 3-agent setup"
```

---

### Task 9: Build verification

**Step 1: Run TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run full build**

Run: `npx tsc`
Expected: `dist/` directory created with compiled JS

**Step 3: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve any build issues"
```
