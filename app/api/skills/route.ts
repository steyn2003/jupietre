import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import { createSkill, listVisibleSkills } from "@/lib/db/skills";

const createSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(2)
    .max(60),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  body: z.string().min(1).max(200_000),
  teamId: z.string().nullable().optional(),
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await listVisibleSkills(session.userId, myTeamIds);
  return Response.json({ skills: rows });
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
  try {
    const row = await createSkill({
      ownerId: session.userId,
      teamId: d.teamId ?? null,
      slug: d.slug,
      name: d.name,
      description: d.description,
      body: d.body,
    });
    return Response.json({ skill: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      return Response.json(
        { error: `Slug "${d.slug}" already in use` },
        { status: 409 },
      );
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
