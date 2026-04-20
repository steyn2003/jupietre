import "server-only";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { recordArtifact } from "@/lib/db/artifacts";

const exec = promisify(execFile);

function worktreesRoot(): string {
  const base = process.env.REPOS_BASE_DIR ?? "/data/repos";
  return path.join(base, ".jupietre-worktrees");
}

function worktreePathFor(branch: string): string {
  // Sanitize branch → filesystem-safe dir name.
  const safe = branch.replace(/[^a-zA-Z0-9._\-/]/g, "_");
  return path.join(worktreesRoot(), safe);
}

async function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 60_000,
): Promise<string> {
  const { stdout, stderr } = await exec(cmd, args, {
    cwd,
    env: process.env,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  const combined = stderr ? `${stdout}\n${stderr}`.trim() : stdout.trim();
  return combined;
}

async function installDeps(dir: string): Promise<void> {
  if (existsSync(path.join(dir, "package.json"))) {
    let cmd: string;
    let args: string[];
    if (
      existsSync(path.join(dir, "bun.lockb")) ||
      existsSync(path.join(dir, "bun.lock"))
    ) {
      cmd = "bun";
      args = ["install", "--frozen-lockfile"];
    } else if (existsSync(path.join(dir, "pnpm-lock.yaml"))) {
      cmd = "pnpm";
      args = ["install", "--frozen-lockfile"];
    } else if (existsSync(path.join(dir, "yarn.lock"))) {
      cmd = "yarn";
      args = ["install", "--frozen-lockfile"];
    } else {
      cmd = "npm";
      args = ["ci"];
    }
    console.log(`[worktree] installing JS deps with ${cmd} in ${dir}`);
    await exec(cmd, args, { cwd: dir, timeout: 120_000 }).catch((err) => {
      console.warn(`[worktree] ${cmd} install failed:`, err);
    });
  }
  if (existsSync(path.join(dir, "pyproject.toml"))) {
    console.log(`[worktree] installing Python deps with uv in ${dir}`);
    await exec("uv", ["sync"], { cwd: dir, timeout: 120_000 }).catch((err) => {
      console.warn(`[worktree] uv sync failed:`, err);
    });
  }
}

async function resolveRepoSlug(cwd: string): Promise<string | null> {
  try {
    const out = await run("gh", ["repo", "view", "--json", "nameWithOwner"], cwd);
    const parsed = JSON.parse(out.split(/\r?\n/)[0] ?? "{}") as {
      nameWithOwner?: string;
    };
    return parsed.nameWithOwner ?? null;
  } catch {
    return null;
  }
}

export function buildGithubTools(sessionId: string, repoPath: string) {
  return [
    tool(
      "git_create_worktree",
      "Create a git worktree for isolated development on a new branch. Installs JS/Python deps after checkout.",
      {
        branch: z
          .string()
          .describe("New branch name, e.g. 'agent/FOO-123'"),
        baseBranch: z
          .string()
          .default("main")
          .describe("Base branch to fork from"),
      },
      async ({ branch, baseBranch }) => {
        const worktreeDir = worktreePathFor(branch);
        await run("git", ["fetch", "origin", baseBranch], repoPath, 120_000);
        await run(
          "git",
          [
            "worktree",
            "add",
            "-b",
            branch,
            worktreeDir,
            `origin/${baseBranch}`,
          ],
          repoPath,
        );
        await installDeps(worktreeDir);
        await recordArtifact({
          sessionId,
          kind: "worktree",
          title: `Worktree ${branch}`,
          summary: `Based on origin/${baseBranch} at ${worktreeDir}`,
          externalId: branch,
          raw: { worktreeDir, baseBranch },
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Worktree created at ${worktreeDir} on branch ${branch} (dependencies installed)`,
            },
          ],
        };
      },
    ),

    tool(
      "git_push_branch",
      "Push a branch to the remote origin.",
      {
        branch: z.string(),
      },
      async ({ branch }) => {
        const worktreeDir = worktreePathFor(branch);
        const cwd = existsSync(worktreeDir) ? worktreeDir : repoPath;
        const result = await run(
          "git",
          ["push", "origin", branch],
          cwd,
          120_000,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: result || `Pushed ${branch}`,
            },
          ],
        };
      },
    ),

    tool(
      "gh_create_pr",
      "Create a GitHub pull request via the gh CLI. Repo is auto-detected from the worktree.",
      {
        title: z.string(),
        body: z.string().describe("PR body in markdown"),
        head: z.string().describe("Head branch name"),
        base: z.string().default("main").describe("Base branch name"),
        labels: z.array(z.string()).default([]),
      },
      async ({ title, body, head, base, labels }) => {
        const worktreeDir = worktreePathFor(head);
        const cwd = existsSync(worktreeDir) ? worktreeDir : repoPath;
        const repoSlug =
          process.env.GITHUB_REPO ?? (await resolveRepoSlug(cwd));
        const args = [
          "pr",
          "create",
          "--title",
          title,
          "--body",
          body,
          "--base",
          base,
          "--head",
          head,
        ];
        if (repoSlug) args.push("--repo", repoSlug);
        if (labels.length > 0) args.push("--label", labels.join(","));

        const result = await run("gh", args, cwd, 120_000);
        const urlMatch = result.match(/https?:\/\/\S*pull\/\d+/);
        const prUrl = urlMatch?.[0];
        const prNumber = prUrl?.match(/\/pull\/(\d+)/)?.[1];
        await recordArtifact({
          sessionId,
          kind: "pr",
          title,
          url: prUrl ?? null,
          summary: body.slice(0, 280),
          externalId: prNumber ?? `${head}:${Date.now()}`,
          raw: { head, base, labels, rawOutput: result },
        });
        return { content: [{ type: "text" as const, text: result }] };
      },
    ),

    tool(
      "git_cleanup_worktree",
      "Remove a git worktree after work is complete.",
      {
        branch: z.string(),
      },
      async ({ branch }) => {
        const worktreeDir = worktreePathFor(branch);
        await run("git", ["worktree", "remove", worktreeDir], repoPath);
        return {
          content: [
            {
              type: "text" as const,
              text: `Worktree removed for ${branch}`,
            },
          ],
        };
      },
    ),

    tool(
      "gh_pr_review",
      "Approve or request changes on a GitHub pull request.",
      {
        prNumber: z.number(),
        action: z.enum(["approve", "request-changes"]),
        body: z.string(),
      },
      async ({ prNumber, action, body }) => {
        const repoSlug =
          process.env.GITHUB_REPO ?? (await resolveRepoSlug(repoPath));
        const flag = action === "approve" ? "--approve" : "--request-changes";
        const args = [
          "pr",
          "review",
          String(prNumber),
          flag,
          "--body",
          body,
        ];
        if (repoSlug) args.push("--repo", repoSlug);
        const result = await run("gh", args, repoPath);
        return {
          content: [
            {
              type: "text" as const,
              text: result || `PR #${prNumber} reviewed (${action})`,
            },
          ],
        };
      },
    ),
  ];
}
