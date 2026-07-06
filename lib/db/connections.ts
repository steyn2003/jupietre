import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  agentConnectionGrants,
  connections,
  type ConnectionConfig,
} from "./schema";

export type Connection = typeof connections.$inferSelect;
export type ConnectionGrant = typeof agentConnectionGrants.$inferSelect;
export type ConnectionKind = Connection["kind"];
export type { ConnectionConfig };
type NewConnection = typeof connections.$inferInsert;

// Narrowed per-kind config shapes (the schema union is unindexed by kind).
export type LinearConfig = { apiKey: string };
export type GithubConfig = { token: string };
export type McpStdioConfig = {
  transport: "stdio";
  command: string;
  args: string[];
};
export type McpHttpConfig = {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
};
export type McpConfig = McpStdioConfig | McpHttpConfig;

// ─── redaction ───────────────────────────────────────────────────────
//
// Secrets NEVER leave the server. Everything that reaches the client (API
// list, page, canvas) goes through redactConnection: it exposes the
// non-secret surface and reports whether a secret is set (+ its last four).

export interface RedactedConnection {
  id: string;
  ownerId: string;
  teamId: string | null;
  kind: ConnectionKind;
  name: string;
  slug: string;
  /** True when the row holds a credential (apiKey / token / http headers). */
  hasSecret: boolean;
  /** Last four chars of the primary secret — enough to disambiguate keys. */
  lastFour: string | null;
  /** Non-secret config for forms + the canvas. Linear/github expose nothing. */
  publicConfig:
    | { transport: "stdio"; command: string; args: string[] }
    | { transport: "http"; url: string; headerKeys: string[] }
    | null;
  createdAt: string;
  updatedAt: string;
}

function lastFourOf(secret: string): string | null {
  const s = secret.trim();
  return s.length >= 4 ? s.slice(-4) : s.length > 0 ? s : null;
}

export function redactConnection(c: Connection): RedactedConnection {
  const base = {
    id: c.id,
    ownerId: c.ownerId,
    teamId: c.teamId,
    kind: c.kind,
    name: c.name,
    slug: c.slug,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
  if (c.kind === "linear") {
    const cfg = c.configJson as LinearConfig;
    return {
      ...base,
      hasSecret: Boolean(cfg.apiKey),
      lastFour: cfg.apiKey ? lastFourOf(cfg.apiKey) : null,
      publicConfig: null,
    };
  }
  if (c.kind === "github") {
    const cfg = c.configJson as GithubConfig;
    return {
      ...base,
      hasSecret: Boolean(cfg.token),
      lastFour: cfg.token ? lastFourOf(cfg.token) : null,
      publicConfig: null,
    };
  }
  const cfg = c.configJson as McpConfig;
  if (cfg.transport === "stdio") {
    return {
      ...base,
      hasSecret: false,
      lastFour: null,
      publicConfig: { transport: "stdio", command: cfg.command, args: cfg.args },
    };
  }
  const headerKeys = cfg.headers ? Object.keys(cfg.headers) : [];
  return {
    ...base,
    hasSecret: headerKeys.length > 0,
    lastFour: null,
    publicConfig: { transport: "http", url: cfg.url, headerKeys },
  };
}

// ─── connections CRUD ────────────────────────────────────────────────

/** Own connections + any team-scoped connection the user can see. */
export async function listVisibleConnections(
  ownerId: string,
  myTeamIds: string[],
): Promise<Connection[]> {
  if (myTeamIds.length === 0) {
    return db
      .select()
      .from(connections)
      .where(eq(connections.ownerId, ownerId));
  }
  return db
    .select()
    .from(connections)
    .where(
      or(
        eq(connections.ownerId, ownerId),
        inArray(connections.teamId, myTeamIds),
      ),
    );
}

export async function getConnectionById(
  id: string,
): Promise<Connection | null> {
  const rows = await db
    .select()
    .from(connections)
    .where(eq(connections.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createConnection(
  input: Omit<NewConnection, "id" | "createdAt" | "updatedAt">,
): Promise<Connection> {
  const id = nanoid();
  const [row] = await db
    .insert(connections)
    .values({ ...input, id })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updateConnection(
  id: string,
  patch: Partial<Omit<NewConnection, "id" | "ownerId" | "kind" | "createdAt">>,
): Promise<Connection | null> {
  const [row] = await db
    .update(connections)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(connections.id, id))
    .returning();
  return row ?? null;
}

export async function deleteConnection(id: string): Promise<void> {
  await db.delete(connections).where(eq(connections.id, id));
}

// ─── grants ──────────────────────────────────────────────────────────

/** Connections granted to a single agent. */
export async function grantsForAgent(
  agentConfigId: string,
): Promise<ConnectionGrant[]> {
  return db
    .select()
    .from(agentConnectionGrants)
    .where(eq(agentConnectionGrants.agentConfigId, agentConfigId));
}

/** The full Connection rows granted to an agent (join). Used by the runtime
 *  so it has the config secrets in hand without a second round-trip. */
export async function grantedConnectionsForAgent(
  agentConfigId: string,
): Promise<Connection[]> {
  const rows = await db
    .select({ conn: connections })
    .from(agentConnectionGrants)
    .innerJoin(
      connections,
      eq(connections.id, agentConnectionGrants.connectionId),
    )
    .where(eq(agentConnectionGrants.agentConfigId, agentConfigId));
  return rows.map((r) => r.conn);
}

/** Agents holding a grant on a connection (for the "who has this" badges). */
export async function grantsForConnection(
  connectionId: string,
): Promise<ConnectionGrant[]> {
  return db
    .select()
    .from(agentConnectionGrants)
    .where(eq(agentConnectionGrants.connectionId, connectionId));
}

/** Batch: all grants for a set of agents. One query for the graph endpoint. */
export async function grantsForAgents(
  agentConfigIds: string[],
): Promise<ConnectionGrant[]> {
  if (agentConfigIds.length === 0) return [];
  return db
    .select()
    .from(agentConnectionGrants)
    .where(inArray(agentConnectionGrants.agentConfigId, agentConfigIds));
}

/** Batch: all grants pointing at a set of connections. */
export async function grantsForConnections(
  connectionIds: string[],
): Promise<ConnectionGrant[]> {
  if (connectionIds.length === 0) return [];
  return db
    .select()
    .from(agentConnectionGrants)
    .where(inArray(agentConnectionGrants.connectionId, connectionIds));
}

/** Idempotent — the unique index means a duplicate grant is a no-op. */
export async function createGrant(
  agentConfigId: string,
  connectionId: string,
): Promise<ConnectionGrant> {
  const existing = await db
    .select()
    .from(agentConnectionGrants)
    .where(
      and(
        eq(agentConnectionGrants.agentConfigId, agentConfigId),
        eq(agentConnectionGrants.connectionId, connectionId),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];
  const id = nanoid();
  const [row] = await db
    .insert(agentConnectionGrants)
    .values({ id, agentConfigId, connectionId })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function deleteGrant(
  agentConfigId: string,
  connectionId: string,
): Promise<void> {
  await db
    .delete(agentConnectionGrants)
    .where(
      and(
        eq(agentConnectionGrants.agentConfigId, agentConfigId),
        eq(agentConnectionGrants.connectionId, connectionId),
      ),
    );
}
