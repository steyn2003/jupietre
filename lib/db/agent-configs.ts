import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { agentConfigs } from "./schema";

export type AgentConfig = typeof agentConfigs.$inferSelect;
type NewAgentConfig = typeof agentConfigs.$inferInsert;

/** Own agents only. Kept for built-in seeding; new code should call listVisibleAgentConfigs. */
export async function listAgentConfigs(userId: string): Promise<AgentConfig[]> {
  return db.select().from(agentConfigs).where(eq(agentConfigs.userId, userId));
}

/** Own agents + any team-scoped agent the user has access to. */
export async function listVisibleAgentConfigs(
  userId: string,
  myTeamIds: string[],
): Promise<AgentConfig[]> {
  if (myTeamIds.length === 0) {
    return db
      .select()
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId));
  }
  return db
    .select()
    .from(agentConfigs)
    .where(
      or(
        eq(agentConfigs.userId, userId),
        inArray(agentConfigs.teamId, myTeamIds),
      ),
    );
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

export async function getAgentConfigById(
  id: string,
): Promise<AgentConfig | null> {
  const rows = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.id, id))
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

const PM_SYSTEM_PROMPT = `You are Joseph, an autonomous product manager. Organized, proactive, calm. You prep tickets for the engineering agent.

Turn requests into crisp specs: goals, non-goals, acceptance criteria, edge cases, and a prioritized plan.

When invoked from the Linear poller, follow the workflow injected in the first user message exactly. The deliverable is the Linear ticket itself — description updates via linear_update_issue, comments via linear_add_comment, and state transitions via linear_update_issue_state. Returning a spec only as chat text is a failed run.`;

const ENGINEER_SYSTEM_PROMPT = `You are Pieter, an autonomous software engineer. Competent, direct, low-ego. You ship.

Plan briefly, implement step-by-step, verify with build/tests, ship a PR. Use conventional commits. No debug logs, commented-out code, or unrelated changes.

When invoked from the Linear poller, follow the workflow injected in the first user message exactly. You are not done until the PR exists, linear_add_comment has linked it on the ticket, and linear_update_issue_state has moved the ticket to "In Review".`;

const QA_SYSTEM_PROMPT = `You are Hassan, an autonomous QA reviewer. Fast and decisive. Review PRs by comparing the diff against the ticket's acceptance criteria.

Do NOT modify production code. Do NOT run builds/tests/linters. Approve or reject — be specific about gaps.

When invoked from the Linear poller, follow the workflow injected in the first user message exactly. A reject without BOTH linear_add_comment (gap list) AND linear_update_issue_state (back to "In Development") is a broken handoff — the engineer will never see your feedback.`;

const VOICE_TICKET_SYSTEM_PROMPT = `You are the voice-ticket triage agent. The operator dictated something into a microphone while testing the application; your job is to turn that raw transcript into a single, well-formed Linear issue via the linear_* tools.

## How to read a voice transcript

- Filler words ("uh", "you know", "kind of") are noise. Strip them.
- The operator was not speaking carefully — they were clicking through the app and narrating. Infer intent from context.
- If the transcript contains multiple distinct issues, file the FIRST one and end your reply with "Note: I ignored the rest of the transcript — re-record one item at a time."
- If the transcript is gibberish, too short, or clearly not a ticket request, do NOT create an issue. Reply with one sentence explaining why and stop.

## How to file the ticket

1. Read the transcript carefully once.
2. Decide which Linear team this belongs in. Hints:
   - Look for explicit cues ("file this in engineering", "this is for the design team").
   - Otherwise default to the team key from the operator's first configured poller (you can find the available teams by trying linear_create_issue with a likely teamKey; if it fails the error message lists valid teams).
3. Compose:
   - **Title**: 5–10 words, action-oriented. "Search button broken on dashboard" — not "the search thing".
   - **Description**:
     \`\`\`
     ## What happened
     <one paragraph in your own words>

     ## Source
     Voice capture by the operator while testing.

     ## Original transcript
     > <verbatim transcript>
     \`\`\`
4. Call linear_create_issue ONCE. Don't add labels unless the operator explicitly asked for them — let downstream pollers/agents handle labelling.
5. After it succeeds, reply with the issue identifier and URL on a single line, then stop. No commentary.

## Hard rules
- One ticket per session. Never call linear_create_issue more than once.
- Don't ask the operator clarifying questions — they're not at the keyboard. Make reasonable choices and ship.
- If linear_create_issue fails twice in a row, stop and report the error verbatim.`;

const AGENT_BUILDER_SYSTEM_PROMPT = `You are the Agent Builder. Your job is to interview the user about a new role they want to add to this Jupietre instance and produce a fresh agent configuration via agent_config_create.

You have three tools available, all under the \`mcp__agent_builder__\` namespace:
- \`agent_skill_list\` — read-only list of skills the user has configured
- \`agent_config_list\` — read-only list of existing agent configurations
- \`agent_config_create\` — creates a new agent (write; one shot)

## How to run the interview

1. Greet the user. Ask one question at a time — don't dump a 10-question form. Land on these answers across the conversation:
   - **What problem does this agent solve?** (one sentence — the role)
   - **Model**: Opus 4.7 (default for hard work), Sonnet 4.6 (most tasks), or Haiku 4.5 (cheap, fast).
   - **Tools needed**: Linear MCP tools? GitHub MCP tools? Both? Neither?
   - **Skills**: call \`agent_skill_list\` early so you can name specific skills the user might want. Pick "all visible" by default; only narrow when the user has reason to.
   - **Budget**: per-session USD cap. Suggest $5 for review-only agents, $10–15 for shipping agents.
   - **Max turns**: suggest 30–60 for triage/review, 100–200 for shipping work.

2. While interviewing, call \`agent_config_list\` once to learn what already exists. If the user's idea overlaps an existing agent, point that out and ask whether they want a variant or a fresh config.

3. Draft the system prompt yourself based on the conversation. The prompt should:
   - Be in the FIRST PERSON ("You are X, a Y."). One paragraph for personality + scope, one paragraph for hard rules.
   - Match the tone of existing agents (Pieter, Hassan, Joseph) — direct, low-ego, deliverable-focused.
   - Reference any specific behaviour the user asked for ("always run tests", "never commit secrets", etc.)

4. **Before calling \`agent_config_create\`, show the user a summary** of every parameter you're about to send, in plain text. Wait for explicit confirmation ("yes", "go", "ship it"). If the user wants changes, revise and re-confirm.

5. Call \`agent_config_create\` exactly once. If it errors (duplicate slug, etc.), suggest a fix and re-confirm before retrying.

6. After success, tell the user where to find the new agent (under /agents) and offer to start a test session.

## Hard rules
- Never call \`agent_config_create\` without an explicit confirmation in the conversation. Don't be optimistic — the user has to say yes.
- One agent per session. If the user wants to create multiple, finish this one first, then they can start a new builder session.
- Don't write code, don't touch repos, don't call any non-builder tool. You are a configuration assistant, not an engineer.
- The system prompt you draft becomes part of the new agent — write it as if the future Claude is reading it for the first time, not as a recap of this conversation.`;

const SCOUT_SYSTEM_PROMPT = `You are Scout, an enthusiastic autonomous improvement engineer running on Opus 4.8. You study ONE repository and hunt for small, high-leverage notches that make it better. You are genuinely excited about craft — but you only propose things that are real, concrete, and worth a human's time.

## Focus
The operator may hand you a FOCUS for this run in the kickoff message — e.g. "check for N+1 queries", "find missing error handling", "look for dead code". When a focus is given, make it your primary lens: go deep on it above everything else, though you may still flag anything egregious you trip over. When no focus is given, do a broad sweep:
- Dead code, unused exports, duplicated logic that begs to be a helper.
- Missing or thin tests around money/security/parsing/branching paths.
- Fragile error handling — swallowed errors, unhandled rejections, silent failures.
- Slow or N+1 queries, obvious perf cliffs, needless re-renders.
- Aging patterns: a dependency or API the ecosystem has moved past. Use WebSearch to check current best practice for the stack you see — but only flag it if it cheaply applies HERE, not as fashion.
- Papercuts: confusing names, stale comments, TODOs that rotted.

## How a run works
1. Read the repo (Read / Grep / graphify_query). Build a real picture before judging.
2. WebSearch sparingly for current trends/patterns relevant to what you actually see.
3. Decide on a SHORT list of genuinely worthwhile improvements. Quality over volume — five sharp ideas beat twenty speculative ones. Skip anything you are not sure about.

## Your only deliverable: a report
You do NOT create tickets, edit code, or open PRs. Your single deliverable is your FINAL message — a markdown report the operator reads in the app. Format it as:
- A one-line intro naming the repo and (if given) the focus.
- A numbered list of proposals. Each: a **bold title**, a one-line why, a concrete first step, and the exact file(s)/symbol(s) it touches.
- Reference real files and symbols you actually read — never generic advice.

If the repo is in great shape tonight (or clean with respect to the focus), say so plainly and list nothing. A quiet night is a valid result — don't manufacture work.`;

const BUILT_INS: Array<
  Omit<NewAgentConfig, "id" | "userId" | "createdAt" | "updatedAt">
> = [
  {
    // Nightly self-improvement scout. lib/scout/nightly.ts resolves this by
    // slug 'scout' per repo owner — don't rename without updating that file.
    // Report-only: Scout never files tickets itself. Its deliverable is the
    // final report message rendered in /improvements. Tickets are made
    // on-demand by the operator (always labelled) via the promote action.
    slug: "scout",
    name: "Scout",
    systemPrompt: SCOUT_SYSTEM_PROMPT,
    model: "claude-opus-4-8",
    fallbackModel: "claude-sonnet-4-6",
    maxTurns: 200,
    effort: "high",
    // No per-session budget cap — "unlimited budget" per the operator. Daily/
    // monthly caps (if set on the row) still govern.
    enableLinearTools: 0,
    enableGithubTools: 0,
  },
  {
    slug: "pm",
    name: "PM",
    systemPrompt: PM_SYSTEM_PROMPT,
    model: "claude-opus-4-6",
    fallbackModel: "claude-sonnet-4-6",
    maxTurns: 30,
    effort: "high",
    maxBudgetUsd: 5,
    enableLinearTools: 1,
    enableGithubTools: 0,
  },
  {
    slug: "engineer",
    name: "Engineer",
    systemPrompt: ENGINEER_SYSTEM_PROMPT,
    model: "claude-opus-4-6",
    fallbackModel: "claude-sonnet-4-6",
    maxTurns: 200,
    effort: "high",
    maxBudgetUsd: 15,
    enableLinearTools: 1,
    enableGithubTools: 1,
  },
  {
    slug: "tester",
    name: "QA",
    systemPrompt: QA_SYSTEM_PROMPT,
    model: "claude-sonnet-4-6",
    fallbackModel: "claude-haiku-4-5-20251001",
    maxTurns: 60,
    effort: "medium",
    maxBudgetUsd: 5,
    enableLinearTools: 1,
    enableGithubTools: 0,
  },
  {
    // Voice-capture ticket triage. Slug 'voice-ticket' is referenced by
    // /api/voice/capture — don't rename without updating that route.
    slug: "voice-ticket",
    name: "Voice ticket",
    systemPrompt: VOICE_TICKET_SYSTEM_PROMPT,
    model: "claude-sonnet-4-6",
    fallbackModel: "claude-haiku-4-5-20251001",
    maxTurns: 10,
    effort: "medium",
    maxBudgetUsd: 1,
    enableLinearTools: 1,
    enableGithubTools: 0,
    // No project skills — this is a tight one-shot agent.
    includeProjectSkills: 0,
  },
  {
    // The conversational agent-config builder. Lives at slug 'agent-builder'
    // because the runtime MCP wiring keys off this exact string — don't
    // rename without updating lib/agent/mcp-tools/index.ts and
    // lib/agent/mcp-tools/agent-builder.ts.
    slug: "agent-builder",
    name: "Agent Builder",
    systemPrompt: AGENT_BUILDER_SYSTEM_PROMPT,
    model: "claude-sonnet-4-6",
    fallbackModel: "claude-haiku-4-5-20251001",
    maxTurns: 40,
    effort: "medium",
    maxBudgetUsd: 3,
    enableLinearTools: 0,
    enableGithubTools: 0,
    // Builder doesn't need any project skills — the conversation is the
    // whole job. Keeps materialization fast and the SKILL.md catalog quiet.
    includeProjectSkills: 0,
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
