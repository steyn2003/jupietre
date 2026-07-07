import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { canEditConnection, getMyTeamIds } from "@/lib/auth/authz";
import {
  deleteConnection,
  getConnectionById,
  redactConnection,
  updateConnection,
  type ConnectionConfig,
  type GithubConfig,
  type LinearConfig,
  type McpConfig,
} from "@/lib/db/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Secret fields are optional on PATCH — absent means "keep the stored value".
const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  teamId: z.string().nullable().optional(),
  config: z
    .object({
      apiKey: z.string().min(1).max(500).optional(),
      token: z.string().min(1).max(500).optional(),
      transport: z.enum(["stdio", "http"]).optional(),
      command: z.string().min(1).max(500).optional(),
      args: z.array(z.string().max(500)).max(50).optional(),
      url: z.string().url().max(1000).optional(),
      headers: z.record(z.string(), z.string().max(2000)).optional(),
    })
    .optional(),
});

/** Merge an incoming partial config into the stored one, per kind. Secrets
 *  absent from the patch are preserved from `existing`. */
function mergeConfig(
  kind: "linear" | "github" | "mcp",
  existing: ConnectionConfig,
  incoming: z.infer<typeof patchSchema>["config"],
): ConnectionConfig {
  if (!incoming) return existing;
  if (kind === "linear") {
    const ex = existing as LinearConfig;
    return { apiKey: incoming.apiKey ?? ex.apiKey };
  }
  if (kind === "github") {
    const ex = existing as GithubConfig;
    return { token: incoming.token ?? ex.token };
  }
  const ex = existing as McpConfig;
  const transport = incoming.transport ?? ex.transport;
  if (transport === "stdio") {
    const stdioEx = ex.transport === "stdio" ? ex : null;
    return {
      transport: "stdio",
      command: incoming.command ?? stdioEx?.command ?? "",
      args: incoming.args ?? stdioEx?.args ?? [],
    };
  }
  const httpEx = ex.transport === "http" ? ex : null;
  const headers = incoming.headers ?? httpEx?.headers;
  return {
    transport: "http",
    url: incoming.url ?? httpEx?.url ?? "",
    ...(headers ? { headers } : {}),
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getConnectionById(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (
    !(await canEditConnection(session.userId, {
      ownerId: existing.ownerId,
      teamId: existing.teamId,
    }))
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  if (d.teamId) {
    const myTeamIds = await getMyTeamIds(session.userId);
    if (!myTeamIds.includes(d.teamId)) {
      return Response.json(
        { error: "Not a member of that team" },
        { status: 400 },
      );
    }
  }

  const patch: Record<string, unknown> = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.teamId !== undefined) patch.teamId = d.teamId;
  if (d.config !== undefined)
    patch.configJson = mergeConfig(existing.kind, existing.configJson, d.config);

  const row = await updateConnection(id, patch);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ connection: redactConnection(row) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await getConnectionById(id);
  if (!existing) return Response.json({ ok: true });
  if (
    !(await canEditConnection(session.userId, {
      ownerId: existing.ownerId,
      teamId: existing.teamId,
    }))
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteConnection(id);
  return Response.json({ ok: true });
}
