import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { getMyTeamIds } from "@/lib/auth/authz";
import {
  createWorkflow,
  listVisibleWorkflows,
} from "@/lib/workflows/runs";
import { workflowDefinitionSchema } from "@/lib/workflows/definitions";

const slugSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

const createSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(80),
  teamId: z.string().nullable().optional(),
  definition: workflowDefinitionSchema,
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const myTeamIds = await getMyTeamIds(session.userId);
  const rows = await listVisibleWorkflows(session.userId, myTeamIds);
  return Response.json({ workflows: rows });
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
    const row = await createWorkflow({
      ownerId: session.userId,
      teamId: d.teamId ?? null,
      slug: d.slug,
      name: d.name,
      definition: d.definition,
    });
    return Response.json({ workflow: row });
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
