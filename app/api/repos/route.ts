import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { repos } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds, visibleReposWhere } from "@/lib/auth/authz";
import { registerRepo, RepoError } from "@/lib/repos/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters / digits / hyphens"),
  githubRepo: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "must be `owner/name`"),
  teamId: z.string().nullable().optional(),
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await db
    .select()
    .from(repos)
    .where(visibleReposWhere(session.userId, myTeamIds));
  return Response.json({ repos: rows });
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

  // If the caller picked a team, verify membership.
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
    const repo = await registerRepo({
      userId: session.userId,
      teamId: d.teamId ?? null,
      slug: d.slug,
      githubRepo: d.githubRepo,
    });
    return Response.json({ repo });
  } catch (err) {
    if (err instanceof RepoError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
