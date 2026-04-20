import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const MAX_FILE_BYTES = 256 * 1024;

export type FileDiffError =
  | "not-found"
  | "outside-repo"
  | "too-large"
  | "binary";

export interface FileHunk {
  header: string;
  oldStart: number;
  newStart: number;
}

export interface FileDiff {
  path: string;
  patch: string;
  /** Highlighted patch HTML (set by the API layer, not here). */
  patchHtml?: string;
  currentContents: string;
  /** Highlighted current-file HTML. */
  currentHtml?: string;
  language: string;
  hunks: FileHunk[];
  sizeBytes: number;
  error: FileDiffError | null;
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  php: "php",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  json: "json",
  jsonc: "jsonc",
  md: "markdown",
  mdx: "mdx",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  dockerfile: "docker",
};

export function detectLanguage(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  if (/^Dockerfile(\..+)?$/i.test(base)) return "docker";
  if (/^Makefile$/i.test(base)) return "makefile";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return LANGUAGE_MAP[ext] ?? "text";
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

function parseHunks(patch: string): FileHunk[] {
  const out: FileHunk[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (m) {
      out.push({
        header: line,
        oldStart: Number(m[1]),
        newStart: Number(m[2]),
      });
    }
  }
  return out;
}

/**
 * Resolve `relPath` inside `repoPath`, refusing escape attempts.
 * Returns null when the resolved path leaves the repo or doesn't exist.
 */
export function safeResolveInRepo(
  repoPath: string,
  relPath: string,
): string | null {
  const repoAbs = path.resolve(repoPath);
  const target = path.resolve(repoAbs, relPath);
  const rel = path.relative(repoAbs, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

export async function getFileDiff(
  repoPath: string,
  relPath: string,
): Promise<FileDiff> {
  const empty: FileDiff = {
    path: relPath,
    patch: "",
    currentContents: "",
    language: detectLanguage(relPath),
    hunks: [],
    sizeBytes: 0,
    error: null,
  };

  if (!existsSync(repoPath))
    return { ...empty, error: "not-found" };

  const target = safeResolveInRepo(repoPath, relPath);
  if (!target) return { ...empty, error: "outside-repo" };

  // patch — works whether the file is tracked / staged / untracked
  let patch = "";
  try {
    const { stdout } = await execFileP(
      "git",
      ["diff", "HEAD", "--", relPath],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024, windowsHide: true },
    );
    patch = stdout;
  } catch {
    // file may have just been added but not staged — try a no-index diff
    try {
      const { stdout } = await execFileP(
        "git",
        ["diff", "--no-index", "--", "/dev/null", relPath],
        { cwd: repoPath, maxBuffer: 5 * 1024 * 1024, windowsHide: true },
      );
      patch = stdout;
    } catch {
      // give up on patch but keep going for the current file view
    }
  }

  // current file
  if (!existsSync(target)) {
    // file was deleted — return patch only, no current contents
    return {
      ...empty,
      patch,
      hunks: parseHunks(patch),
    };
  }

  const stats = await stat(target);
  if (stats.size > MAX_FILE_BYTES) {
    return {
      ...empty,
      patch,
      hunks: parseHunks(patch),
      sizeBytes: stats.size,
      error: "too-large",
    };
  }

  const buf = await readFile(target);
  if (looksBinary(buf)) {
    return {
      ...empty,
      patch,
      hunks: parseHunks(patch),
      sizeBytes: stats.size,
      error: "binary",
    };
  }

  return {
    path: relPath,
    patch,
    currentContents: buf.toString("utf8"),
    language: detectLanguage(relPath),
    hunks: parseHunks(patch),
    sizeBytes: stats.size,
    error: null,
  };
}
