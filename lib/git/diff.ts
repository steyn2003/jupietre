import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const MAX_DIFF_LENGTH = 100_000;

export interface RepoDiff {
  branch: string | null;
  changedFiles: Array<{ status: string; path: string }>;
  diff: string;
  truncated: boolean;
  recentCommits: Array<{ hash: string; subject: string; when: string }>;
  worktrees: string[];
  error: string | null;
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

export async function getRepoDiff(repoPath: string): Promise<RepoDiff> {
  const empty: RepoDiff = {
    branch: null,
    changedFiles: [],
    diff: "",
    truncated: false,
    recentCommits: [],
    worktrees: [],
    error: null,
  };

  if (!existsSync(repoPath)) {
    return { ...empty, error: `Path does not exist: ${repoPath}` };
  }

  try {
    const [{ stdout: branchOut }, { stdout: statusOut }, { stdout: diffOut }, { stdout: logOut }, { stdout: wtOut }] =
      await Promise.all([
        git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ({
          stdout: "",
          stderr: "",
        })),
        git(repoPath, ["status", "--porcelain=v1"]).catch(() => ({
          stdout: "",
          stderr: "",
        })),
        git(repoPath, ["diff", "HEAD"]).catch(() => ({
          stdout: "",
          stderr: "",
        })),
        git(repoPath, [
          "log",
          "--pretty=format:%h\t%s\t%cr",
          "-n",
          "10",
        ]).catch(() => ({ stdout: "", stderr: "" })),
        git(repoPath, ["worktree", "list", "--porcelain"]).catch(() => ({
          stdout: "",
          stderr: "",
        })),
      ]);

    const changedFiles = statusOut
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));

    const truncated = diffOut.length > MAX_DIFF_LENGTH;
    const diff = truncated ? diffOut.slice(0, MAX_DIFF_LENGTH) : diffOut;

    const recentCommits = logOut
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, when] = line.split("\t");
        return { hash: hash ?? "", subject: subject ?? "", when: when ?? "" };
      });

    const worktrees: string[] = [];
    for (const line of wtOut.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) worktrees.push(line.slice(9));
    }

    return {
      branch: branchOut.trim() || null,
      changedFiles,
      diff,
      truncated,
      recentCommits,
      worktrees,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...empty, error: message };
  }
}
