import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import {
  createConnection,
  listVisibleConnections,
  redactConnection,
  type ConnectionConfig,
} from "@/lib/db/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slug = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters / digits / hyphens");
const name = z.string().min(1).max(80);
const teamId = z.string().nullable().optional();

const linearConfig = z.object({ apiKey: z.string().min(1).max(500) });
const githubConfig = z.object({ token: z.string().min(1).max(500) });
const mcpConfig = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("stdio"),
    command: z.string().min(1).max(500),
    args: z.array(z.string().max(500)).max(50).default([]),
  }),
  z.object({
    transport: z.literal("http"),
    url: z.string().url().max(1000),
    headers: z.record(z.string(), z.string().max(2000)).optional(),
  }),
]);

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("linear"), name, slug, teamId, config: linearConfig }),
  z.object({ kind: z.literal("github"), name, slug, teamId, config: githubConfig }),
  z.object({ kind: z.literal("mcp"), name, slug, teamId, config: mcpConfig }),
]);

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await listVisibleConnections(session.userId, myTeamIds);
  return Response.json({ connections: rows.map(redactConnection) });
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
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

  try {
    const row = await createConnection({
      ownerId: session.userId,
      teamId: d.teamId ?? null,
      kind: d.kind,
      name: d.name,
      slug: d.slug,
      configJson: d.config as ConnectionConfig,
    });
    return Response.json({ connection: redactConnection(row) });
  } catch (err) {
    // Unique (owner, slug) collision → friendly 409.
    if (
      err instanceof Error &&
      /connections_owner_slug_idx|duplicate key|unique/i.test(err.message)
    ) {
      return Response.json(
        { error: `A connection with slug "${d.slug}" already exists.` },
        { status: 409 },
      );
    }
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
