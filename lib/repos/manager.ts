import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { resolveDataDir } from "@/lib/worktrees/manager";

const execFileP = promisify(execFile);

export type Repo = typeof repos.$inferSelect;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const GH_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export class RepoError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 500,
  ) {
    super(message);
  }
}

export function reposRoot(): string {
  return path.join(resolveDataDir(), "repos");
}

export function clonePathForSlug(slug: string): string {
  return path.join(reposRoot(), slug);
}

async function git(
  cwd: string | undefined,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileP("git", args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  return { stdout: stdout ?? "", stderr: stderr ?? "" };
}

/**
 * Build the HTTPS clone URL. When GITHUB_TOKEN is set we embed it as the
 * username so private repos clone without a credential helper.
 */
function cloneUrlFor(githubRepo: string): string {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    return `https://x-access-token:${token}@github.com/${githubRepo}.git`;
  }
  return `https://github.com/${githubRepo}.git`;
}

async function detectDefaultBranch(repoPath: string): Promise<string> {
  // Prefer the symbolic ref `origin/HEAD` set by clone (e.g. `refs/remotes/origin/main`).
  try {
    const { stdout } = await git(repoPath, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    const ref = stdout.trim();
    const idx = ref.lastIndexOf("/");
    if (idx > 0) return ref.slice(idx + 1);
  } catch {
    // fall through to git remote show
  }
  try {
    const { stdout } = await git(repoPath, ["remote", "show", "origin"]);
    const m = /HEAD branch:\s*(\S+)/.exec(stdout);
    if (m && m[1] && m[1] !== "(unknown)") return m[1];
  } catch {
    // ignore
  }
  return "main";
}

export interface RegisterRepoInput {
  userId: string;
  teamId: string | null;
  slug: string;
  githubRepo: string;
}

/**
 * Validate, clone, and persist. Synchronous from the caller's perspective —
 * the route holds the request open until clone finishes (fine for v1; long
 * clones are rare, single-user scale).
 */
export async function registerRepo(
  input: RegisterRepoInput,
): Promise<Repo> {
  const slug = input.slug.trim().toLowerCase();
  const githubRepo = input.githubRepo.trim();

  if (!SLUG_RE.test(slug)) {
    throw new RepoError(
      "Slug must be lowercase letters, digits or `-` (max 40 chars)",
      400,
    );
  }
  if (!GH_RE.test(githubRepo)) {
    throw new RepoError(
      "GitHub repo must be `owner/name` (no URL, no `.git`)",
      400,
    );
  }

  const existing = await db
    .select()
    .from(repos)
    .where(and(eq(repos.userId, input.userId), eq(repos.slug, slug)))
    .limit(1);
  if (existing.length > 0) {
    throw new RepoError(`Slug "${slug}" is already in use`, 409);
  }

  const clonePath = clonePathForSlug(slug);
  await mkdir(reposRoot(), { recursive: true });

  // If the dir already exists from a half-finished previous attempt, refuse so
  // we never silently take over someone else's checkout.
  if (existsSync(clonePath)) {
    throw new RepoError(
      `Path ${clonePath} already exists on disk — pick another slug or remove it first`,
      409,
    );
  }

  try {
    await git(reposRoot(), ["clone", cloneUrlFor(githubRepo), slug]);
  } catch (err) {
    // Rollback the dir on partial-clone failure.
    if (existsSync(clonePath)) {
      await rm(clonePath, { recursive: true, force: true }).catch(() => {});
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Strip the embedded token from any error containing the URL.
    const safe = msg.replace(/https:\/\/x-access-token:[^@]+@/g, "https://");
    throw new RepoError(`Clone failed: ${safe}`, 500);
  }

  const defaultBranch = await detectDefaultBranch(clonePath);

  const id = nanoid();
  const [row] = await db
    .insert(repos)
    .values({
      id,
      userId: input.userId,
      teamId: input.teamId,
      slug,
      githubRepo,
      defaultBranch,
      clonePath,
    })
    .returning();
  if (!row) throw new RepoError("Insert returned no row", 500);

  return row;
}

/** Best-effort. Removes the on-disk clone, then deletes the row. */
export async function removeRepo(repo: Repo): Promise<void> {
  if (existsSync(repo.clonePath)) {
    try {
      await rm(repo.clonePath, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[repo] rm failed for ${repo.clonePath}:`, err);
    }
  }
  await db.delete(repos).where(eq(repos.id, repo.id));
}

/** Useful for the runner: refresh a remote so a worktree fetch starts hot. */
export async function fetchRepo(repo: Repo): Promise<void> {
  if (!existsSync(repo.clonePath)) return;
  try {
    await git(repo.clonePath, ["fetch", "--all", "--prune"]);
  } catch (err) {
    console.warn(`[repo] fetch failed for ${repo.slug}:`, err);
  }
}

export async function listAllRepos(): Promise<Repo[]> {
  return db.select().from(repos);
}

/**
 * Parse `GITHUB_REPOS=slug:owner/name,slug:owner/name,...` and idempotently
 * register any missing entries against `userId`.
 *
 * Run in the background from bootstrap — clones can take seconds and we don't
 * want to block boot. Failures are logged, never thrown.
 */
export async function seedReposFromEnv(userId: string): Promise<void> {
  const raw = process.env.GITHUB_REPOS?.trim();
  if (!raw) return;

  const entries: Array<{ slug: string; githubRepo: string }> = [];
  for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const colonIdx = pair.indexOf(":");
    if (colonIdx === -1) {
      console.warn(`[repos] GITHUB_REPOS entry missing slug: ${pair}`);
      continue;
    }
    const slug = pair.slice(0, colonIdx).trim().toLowerCase();
    const githubRepo = pair.slice(colonIdx + 1).trim();
    if (!slug || !githubRepo) continue;
    entries.push({ slug, githubRepo });
  }
  if (entries.length === 0) return;

  // Filter out anything already registered (by slug for this user OR by
  // clonePath globally — second covers the case where someone seeded under
  // a different user previously and we'd otherwise refuse with EEXIST).
  const existing = await db
    .select({ slug: repos.slug, clonePath: repos.clonePath })
    .from(repos);
  const haveSlug = new Set(
    existing
      .filter(() => true)
      .map((r) => r.slug.toLowerCase()),
  );
  const havePath = new Set(existing.map((r) => r.clonePath));

  for (const e of entries) {
    if (haveSlug.has(e.slug)) continue;
    if (havePath.has(clonePathForSlug(e.slug))) continue;
    try {
      console.log(
        `[repos] Seeding ${e.slug} (${e.githubRepo}) from GITHUB_REPOS…`,
      );
      const repo = await registerRepo({
        userId,
        teamId: null,
        slug: e.slug,
        githubRepo: e.githubRepo,
      });
      console.log(
        `[repos] Seeded ${repo.slug} → ${repo.clonePath} (default branch ${repo.defaultBranch})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[repos] Failed to seed ${e.slug} (${e.githubRepo}): ${msg}`,
      );
    }
  }
}
