import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import {
  createSkillBundle,
  listVisibleSkillBundles,
} from "@/lib/db/skill-bundles";

const createSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(2)
    .max(60),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  skillIds: z.array(z.string()).min(1).max(50),
  instruction: z.string().max(20_000).optional(),
  teamId: z.string().nullable().optional(),
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await listVisibleSkillBundles(session.userId, myTeamIds);
  return Response.json({ bundles: rows });
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
    const row = await createSkillBundle({
      ownerId: session.userId,
      teamId: d.teamId ?? null,
      slug: d.slug,
      name: d.name,
      description: d.description,
      skillIds: d.skillIds,
      instruction: d.instruction ?? "",
    });
    return Response.json({ bundle: row });
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
