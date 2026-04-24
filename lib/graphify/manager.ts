import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Per-repo knowledge graph via graphify. The graph lives in the base clone
 * (`<clonePath>/graphify-out/graph.json`) and is exposed to agents through
 * a stdio MCP server (`python3 -m graphify.serve <graph.json>`) registered
 * in `lib/agent/mcp-tools`.
 *
 * Build and refresh use `graphify update <path>` — tree-sitter only, no LLM
 * calls, idempotent. First build on a large repo can take minutes; we run
 * it fire-and-forget from `registerRepo` / `fetchRepo`, and `await` in the
 * runner so concurrent turns dedupe onto the same in-flight build.
 */

// Callers that start in parallel wait on a single graphify process per repo.
const inflight = new Map<string, Promise<void>>();

export function graphPath(clonePath: string): string {
  return path.join(clonePath, "graphify-out", "graph.json");
}

export function hasGraph(clonePath: string): boolean {
  return existsSync(graphPath(clonePath));
}

export function refreshGraph(clonePath: string): Promise<void> {
  const existing = inflight.get(clonePath);
  if (existing) return existing;

  const p = (async () => {
    try {
      console.log(`[graphify] Refreshing index for ${clonePath}`);
      const started = Date.now();
      await execFileP("graphify", ["update", clonePath], {
        timeout: 600_000,
        maxBuffer: 20 * 1024 * 1024,
      });
      const seconds = Math.round((Date.now() - started) / 1000);
      console.log(`[graphify] Index ready for ${clonePath} (${seconds}s)`);
    } catch (err) {
      console.warn(
        `[graphify] Refresh failed for ${clonePath}:`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      inflight.delete(clonePath);
    }
  })();

  inflight.set(clonePath, p);
  return p;
}
