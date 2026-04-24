import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Per-repo knowledge graph locator. The graph is built by the user on their
 * own machine (`graphify update .`) and committed into each target repo at
 * `graphify-out/graph.json`. The server only reads it — it never runs
 * `graphify update` itself.
 *
 * Served to agents via a stdio MCP server (`python3 -m graphify.serve
 * <graph.json>`) registered in `lib/agent/mcp-tools` when the file exists.
 */

export function graphPath(clonePath: string): string {
  return path.join(clonePath, "graphify-out", "graph.json");
}

export function hasGraph(clonePath: string): boolean {
  return existsSync(graphPath(clonePath));
}
