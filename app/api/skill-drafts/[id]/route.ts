import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { isTeamOwner } from "@/lib/auth/authz";
import {
  deleteSkillDraft,
  getDraftById,
  markDraftReviewed,
  type SkillDraft,
} from "@/lib/db/skill-drafts";
import { createSkill, getSkillBySlug } from "@/lib/db/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

/** Owner-or-team-owner, mirroring skills/agent authz for team-scoped rows. */
async function canReviewDraft(
  userId: string,
  draft: SkillDraft,
): Promise<boolean> {
  if (draft.ownerId === userId) return true;
  if (draft.teamId) return isTeamOwner(userId, draft.teamId);
  return false;
}

/** Suffix -2/-3… against the owner's existing skills so approve never collides
 *  with the skills_owner_slug_idx unique index. */
async function freeSlug(ownerId: string, base: string): Promise<string> {
  if (!(await getSkillBySlug(ownerId, base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await getSkillBySlug(ownerId, candidate))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const draft = await getDraftById(id);
  if (!draft) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await canReviewDraft(session.userId, draft))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (draft.status !== "pending") {
    return Response.json(
      { error: `Draft already ${draft.status}` },
      { status: 409 },
    );
  }

  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  if (parsed.data.action === "reject") {
    await markDraftReviewed(id, "rejected");
    return Response.json({ ok: true });
  }

  // Approve → materialize into the real skill library under the draft owner,
  // carrying repoId + teamId. Slug is suffixed to dodge collisions.
  const slug = await freeSlug(draft.ownerId, draft.slug);
  try {
    const skill = await createSkill({
      ownerId: draft.ownerId,
      teamId: draft.teamId,
      repoId: draft.repoId,
      slug,
      name: draft.name,
      description: draft.description,
      body: draft.body,
    });
    await markDraftReviewed(id, "approved");
    return Response.json({ ok: true, skill });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const draft = await getDraftById(id);
  if (!draft) return Response.json({ ok: true });
  if (!(await canReviewDraft(session.userId, draft))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteSkillDraft(id);
  return Response.json({ ok: true });
}
