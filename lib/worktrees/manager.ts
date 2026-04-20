import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Resolve the absolute base directory for Jupietre-managed state (worktrees,
 * eventually clones, gh config). Defaults to `<cwd>/data`. Override with
 * `DATA_DIR` env (absolute path).
 */
export function resolveDataDir(): string {
  const fromEnv = process.env.DATA_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), "data");
}

export function worktreesRoot(): string {
  return path.join(resolveDataDir(), "worktrees");
}

/** Per-session worktree path. Sanitizes id into a filesystem-safe segment. */
export function worktreePathForSession(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "-");
  return path.join(worktreesRoot(), safe);
}

export function worktreeBranchForSession(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "-");
  return `jup/${safe}`;
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileP("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout: stdout ?? "", stderr: stderr ?? "" };
}

export interface ProvisionResult {
  worktreePath: string;
  worktreeBranch: string;
  baseSha: string;
  /** The actual base ref the worktree was created off — `origin/<baseBranch>`
   *  when fetch succeeded, otherwise `HEAD`. Null when no baseBranch was
   *  requested. Useful for showing "based on X" in the UI. */
  baseRef: string | null;
}

/**
 * Create a fresh worktree off `sourceRepoPath` on a new branch named after
 * the session id. Idempotent — if the dir exists we trust it.
 *
 * When `baseBranch` is supplied:
 *   1. `git fetch origin <baseBranch>` to pick up upstream commits.
 *   2. Worktree off `origin/<baseBranch>`.
 *   3. If the fetch or origin lookup fails, fall back to source HEAD with a
 *      console warning — the source repo may not have a remote.
 *
 * Without `baseBranch`, worktree off the source's current HEAD (no fetch).
 *
 * Throws if the source repo isn't a git repo or the worktree creation fails.
 */
export async function provisionWorktree(params: {
  sourceRepoPath: string;
  sessionId: string;
  baseBranch?: string | null;
}): Promise<ProvisionResult> {
  const { sourceRepoPath, sessionId, baseBranch } = params;
  if (!existsSync(sourceRepoPath)) {
    throw new Error(`Source repo path does not exist: ${sourceRepoPath}`);
  }

  const worktreePath = worktreePathForSession(sessionId);
  const worktreeBranch = worktreeBranchForSession(sessionId);

  await mkdir(path.dirname(worktreePath), { recursive: true });

  let startPoint = "HEAD";
  let baseRef: string | null = null;

  if (baseBranch && baseBranch.trim()) {
    const branch = baseBranch.trim();
    try {
      await git(sourceRepoPath, ["fetch", "origin", branch]);
      // Verify the ref now exists locally before pointing the worktree at it.
      await git(sourceRepoPath, [
        "rev-parse",
        "--verify",
        `origin/${branch}`,
      ]);
      startPoint = `origin/${branch}`;
      baseRef = `origin/${branch}`;
    } catch (err) {
      console.warn(
        `[worktree] fetch origin/${branch} failed; falling back to source HEAD:`,
        err,
      );
    }
  }

  // baseSha reflects whatever start point we actually use — `git rev-parse`
  // resolves either `HEAD` or `origin/<branch>`.
  const { stdout: shaOut } = await git(sourceRepoPath, ["rev-parse", startPoint]);
  const baseSha = shaOut.trim();

  if (existsSync(worktreePath)) {
    return { worktreePath, worktreeBranch, baseSha, baseRef };
  }

  await git(sourceRepoPath, [
    "worktree",
    "add",
    "-b",
    worktreeBranch,
    worktreePath,
    startPoint,
  ]);

  return { worktreePath, worktreeBranch, baseSha, baseRef };
}

/**
 * Best-effort cleanup. Tries `git worktree remove --force`, then falls back
 * to `rm -rf` so we never leak orphaned dirs.
 */
export async function removeWorktree(params: {
  sourceRepoPath: string | null;
  worktreePath: string;
  worktreeBranch: string | null;
}): Promise<void> {
  const { sourceRepoPath, worktreePath, worktreeBranch } = params;

  if (sourceRepoPath && existsSync(sourceRepoPath)) {
    try {
      await git(sourceRepoPath, [
        "worktree",
        "remove",
        "--force",
        worktreePath,
      ]);
    } catch (err) {
      console.warn(
        `[worktree] git worktree remove failed for ${worktreePath}:`,
        err,
      );
    }

    if (worktreeBranch) {
      try {
        await git(sourceRepoPath, ["branch", "-D", worktreeBranch]);
      } catch {
        // branch may already be gone; ignore
      }
    }
  }

  if (existsSync(worktreePath)) {
    try {
      await rm(worktreePath, { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `[worktree] rm -rf fallback failed for ${worktreePath}:`,
        err,
      );
    }
  }
}

/** What the runner / diff routes should treat as "the working tree". */
export function effectiveCwd(row: {
  worktreePath: string | null;
  repoPath: string;
}): string {
  return row.worktreePath ?? row.repoPath;
}
