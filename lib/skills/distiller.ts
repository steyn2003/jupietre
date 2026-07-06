import "server-only";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { and, asc, eq, lt, ne, or, isNull, sql as dsql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions, sessionMessages } from "@/lib/db/schema";
import { getMyTeamIds } from "@/lib/auth/authz";
import { listVisibleSkills } from "@/lib/db/skills";
import {
  createSkillDraft,
  listDraftSlugs,
  listPendingDraftNamesForRepo,
} from "@/lib/db/skill-drafts";

// ────────────────────────────────────────────────────────────────────
// Skill distiller. After an agent session goes quiet, a cheap-model one-shot
// pass reads the transcript and extracts durable, repo-specific operational
// knowledge into `skill_drafts` for the operator to approve on /skills.
//
// Same in-process setInterval idiom as lib/schedules/runner.ts — single-node
// assumption. The model call reuses the exact CLI path the runner uses
// (claude-agent-sdk `query()` spawning claude-code) so the same auth works;
// it runs as a lightweight one-shot: maxTurns 1, no tools, no MCP, a scratch
// cwd, cheap model.
// ────────────────────────────────────────────────────────────────────

const TICK_MS = Number(process.env.SKILL_DISTILLER_INTERVAL_MS ?? 300_000);
const INITIAL_DELAY_MS = 30_000;
/** Sessions must be quiet this long before a pass — avoids distilling mid-work. */
const QUIET_MS = 15 * 60 * 1000;
/** Cap per tick to bound cost. */
const MAX_PER_TICK = 3;
/** Enough substance to be worth a pass. */
const MIN_MESSAGES = 6;
/** Transcript budget fed to the model (chars), most-recent-biased. */
const TRANSCRIPT_BUDGET = 30_000;
const MODEL =
  process.env.SKILL_DISTILLER_MODEL ?? "claude-haiku-4-5-20251001";

let started = false;

export function startSkillDistiller(): void {
  if (started) return;
  if (process.env.SKILL_DISTILLER_ENABLED === "0") {
    console.log("[distiller] disabled via SKILL_DISTILLER_ENABLED=0");
    return;
  }
  started = true;
  console.log(
    `[distiller] starting — tick every ${TICK_MS / 1000}s, model=${MODEL}`,
  );
  const tick = () => {
    distillerTick().catch((err) =>
      console.error("[distiller] tick error:", err),
    );
  };
  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, TICK_MS);
}

async function distillerTick(): Promise<void> {
  const cutoff = new Date(Date.now() - QUIET_MS);
  // Candidates: quiet, not running, changed since the last pass, with enough
  // substance. The ≥ MIN_MESSAGES filter is applied via a correlated count.
  const candidates = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        ne(sessions.status, "running"),
        lt(sessions.updatedAt, cutoff),
        or(
          isNull(sessions.distilledAt),
          lt(sessions.distilledAt, sessions.updatedAt),
        ),
        dsql`(SELECT count(*) FROM ${sessionMessages} WHERE ${sessionMessages.sessionId} = ${sessions.id}) >= ${MIN_MESSAGES}`,
      ),
    )
    .orderBy(asc(sessions.updatedAt))
    .limit(MAX_PER_TICK);

  for (const { id } of candidates) {
    try {
      await distillSession(id);
    } catch (err) {
      console.error(`[distiller] session ${id} failed:`, err);
      // Stamp anyway so a persistently-broken session doesn't jam the queue.
      await stampDistilled(id).catch(() => {});
    }
  }
}

async function stampDistilled(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ distilledAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

interface ExtractedSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
}

async function distillSession(sessionId: string): Promise<void> {
  const row = (
    await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  )[0];
  if (!row) return;
  const ownerId = row.ownerId ?? row.userId;

  const transcript = await buildTranscript(sessionId);
  if (!transcript.trim()) {
    await stampDistilled(sessionId);
    return;
  }

  // Dedupe context: existing skills visible to the owner + pending drafts in
  // the same repo scope. We only send names + descriptions to keep it cheap.
  const teamIds = await getMyTeamIds(ownerId);
  const existingSkills = await listVisibleSkills(ownerId, teamIds);
  const pendingDrafts = await listPendingDraftNamesForRepo(ownerId, row.repoId);
  const known = [
    ...existingSkills.map((s) => ({ name: s.name, description: s.description })),
    ...pendingDrafts,
  ];

  const prompt = buildPrompt(transcript, known, row.repoLabel);

  let responseText: string;
  try {
    responseText = await runOneShot(prompt);
  } catch (err) {
    console.warn(`[distiller] model call failed for ${sessionId}:`, err);
    await stampDistilled(sessionId);
    return;
  }

  const extracted = parseSkills(responseText);
  if (extracted.length === 0) {
    await stampDistilled(sessionId);
    console.log(`[distiller] ${sessionId}: nothing durable learned`);
    return;
  }

  // Slug collision suffixing against existing skills + drafts in scope.
  const taken = new Set<string>([
    ...existingSkills.map((s) => s.slug),
    ...(await listDraftSlugs(ownerId)),
  ]);
  let written = 0;
  for (const s of extracted.slice(0, 2)) {
    const slug = uniqueSlug(s.slug, taken);
    taken.add(slug);
    try {
      await createSkillDraft({
        ownerId,
        teamId: row.teamId,
        repoId: row.repoId,
        sourceSessionId: sessionId,
        slug,
        name: s.name.slice(0, 120),
        description: s.description.slice(0, 1_000),
        body: s.body.slice(0, 200_000),
      });
      written++;
    } catch (err) {
      console.warn(`[distiller] draft insert failed (${slug}):`, err);
    }
  }

  await stampDistilled(sessionId);
  console.log(`[distiller] ${sessionId}: wrote ${written} draft(s)`);
}

/** Load the transcript, most-recent-biased truncation to TRANSCRIPT_BUDGET. */
async function buildTranscript(sessionId: string): Promise<string> {
  const rows = await db
    .select({
      indexInSession: sessionMessages.indexInSession,
      kind: sessionMessages.kind,
      text: sessionMessages.text,
    })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(asc(sessionMessages.indexInSession));

  const lines: string[] = [];
  for (const r of rows) {
    if (r.kind === "system") continue;
    const speaker =
      r.kind === "user"
        ? "User"
        : r.kind === "assistant"
          ? "Assistant"
          : "ToolsUsed";
    const text = (r.text ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) continue;
    lines.push(`[${speaker}]: ${text}`);
  }
  const full = lines.join("\n\n");
  if (full.length <= TRANSCRIPT_BUDGET) return full;
  // Keep the tail (most recent) — that's where discovered commands + resolved
  // gotchas usually land.
  return "…(earlier transcript truncated)…\n\n" + full.slice(-TRANSCRIPT_BUDGET);
}

function buildPrompt(
  transcript: string,
  known: { name: string; description: string }[],
  repoLabel: string | null,
): string {
  const knownList =
    known.length > 0
      ? known.map((k) => `- ${k.name}: ${k.description}`).join("\n")
      : "(none)";
  return [
    "You are a skill distiller. You read one agent session transcript and extract durable, REPO-SPECIFIC operational knowledge worth reusing in future sessions on the same repository.",
    "",
    `Repository: ${repoLabel ?? "(unspecified)"}`,
    "",
    "Extract ONLY things like:",
    "- build/test/lint/deploy commands that were actually discovered to work here",
    "- gotchas that were hit and then resolved (and how)",
    "- multi-step procedures specific to this repo that succeeded",
    "",
    "Hard rules:",
    "- Return STRICT JSON and nothing else. Shape:",
    '  { "skills": [ { "slug", "name", "description", "body" } ] }',
    "- 0 to 2 skills. Return an empty array when nothing durable and repo-specific was learned.",
    "- Never restate generic knowledge (how git works, general TypeScript, etc.).",
    "- Never duplicate anything already covered by the EXISTING SKILLS list below.",
    "- slug: kebab-case, short. name: a human label. description: a one-line discovery hint (when the agent should load this skill).",
    "- body: markdown, imperative voice, under 200 lines. Concrete commands and paths, not prose.",
    "",
    "EXISTING SKILLS (do not duplicate these):",
    knownList,
    "",
    "TRANSCRIPT:",
    transcript,
    "",
    "Return the JSON now.",
  ].join("\n");
}

/** Parse the first JSON object out of the model's text; defensive. */
function parseSkills(text: string): ExtractedSkill[] {
  const start = text.indexOf("{");
  if (start === -1) return [];
  // Find the matching close brace for the first object.
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const skillsArr = (parsed as { skills?: unknown })?.skills;
  if (!Array.isArray(skillsArr)) return [];
  const out: ExtractedSkill[] = [];
  for (const raw of skillsArr) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const slug =
      typeof r.slug === "string"
        ? r.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
        : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const description =
      typeof r.description === "string" ? r.description.trim() : "";
    const body = typeof r.body === "string" ? r.body.trim() : "";
    if (!slug || !name || !description || !body) continue;
    out.push({ slug, name, description, body });
  }
  return out;
}

function uniqueSlug(base: string, taken: Set<string>): string {
  const seed = base || "skill";
  if (!taken.has(seed)) return seed;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${seed}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${seed}-${nanoish()}`;
}

function nanoish(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ── One-shot model call — mirrors lib/agent/runner.ts's spawn path ──────────

function resolveBunPath(): string {
  if (process.env.CLAUDE_CODE_EXECUTABLE)
    return process.env.CLAUDE_CODE_EXECUTABLE;
  try {
    const cmd = process.platform === "win32" ? "where.exe bun" : "which bun";
    const output = execSync(cmd, { encoding: "utf8" }).trim();
    const first = output.split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) return first;
  } catch {
    // fall through
  }
  return process.platform === "win32" ? "bun.exe" : "bun";
}

function resolveClaudeCodePath(): string | undefined {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  const candidate = path.join(
    process.cwd(),
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "cli.js",
  );
  return existsSync(candidate) ? candidate : undefined;
}

async function runOneShot(prompt: string): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  // Reuse the runner's auth path: rotate a pooled token onto env if configured,
  // otherwise the ambient CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY is used.
  if (process.env.CLAUDE_TOKENS) {
    const { tokenPool } = await import("@/lib/token-pool");
    tokenPool.init();
    const tok = tokenPool.acquire();
    if (tok) tokenPool.applyToEnv(tok);
  }

  // Scratch cwd — nothing to read, no project settings to load.
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "jup-distiller-"));

  const options: Record<string, unknown> = {
    model: MODEL,
    cwd,
    maxTurns: 1,
    // No tools, no project skills, no MCP — pure one-shot text.
    tools: [],
    disallowedTools: ["*"],
    settingSources: [],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    executable: resolveBunPath(),
  };
  const claudePath = resolveClaudeCodePath();
  if (claudePath) options.pathToClaudeCodeExecutable = claudePath;

  const texts: string[] = [];
  try {
    const session = query({
      prompt,
      options: options as Parameters<typeof query>[0]["options"],
    });
    for await (const message of session as AsyncIterable<unknown>) {
      const m = message as { type?: string; message?: { content?: unknown } };
      if (m.type !== "assistant") continue;
      const content = Array.isArray(m.message?.content) ? m.message.content : [];
      for (const block of content as Array<{ type?: string; text?: string }>) {
        if (block.type === "text" && block.text) texts.push(block.text);
      }
    }
  } finally {
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
  return texts.join("\n");
}
