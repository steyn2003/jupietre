import "server-only";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { skillDrafts } from "./schema";

export type SkillDraft = typeof skillDrafts.$inferSelect;
type NewSkillDraft = typeof skillDrafts.$inferInsert;

/** Pending drafts visible to a user: own + team-scoped. Newest first. */
export async function listVisiblePendingDrafts(
  ownerId: string,
  myTeamIds: string[],
): Promise<SkillDraft[]> {
  const scope =
    myTeamIds.length === 0
      ? eq(skillDrafts.ownerId, ownerId)
      : or(
          eq(skillDrafts.ownerId, ownerId),
          inArray(skillDrafts.teamId, myTeamIds),
        );
  return db
    .select()
    .from(skillDrafts)
    .where(and(eq(skillDrafts.status, "pending"), scope))
    .orderBy(desc(skillDrafts.createdAt));
}

/** Pending draft names for a repo scope — dedupe context for the distiller.
 *  repoId null matches drafts with a null repoId (global scope). */
export async function listPendingDraftNamesForRepo(
  ownerId: string,
  repoId: string | null,
): Promise<{ name: string; description: string }[]> {
  const rows = await db
    .select({
      name: skillDrafts.name,
      description: skillDrafts.description,
    })
    .from(skillDrafts)
    .where(
      and(
        eq(skillDrafts.ownerId, ownerId),
        eq(skillDrafts.status, "pending"),
        repoId === null
          ? isNull(skillDrafts.repoId)
          : eq(skillDrafts.repoId, repoId),
      ),
    );
  return rows;
}

/** Existing slugs (own drafts, any status) for slug-collision suffixing. */
export async function listDraftSlugs(ownerId: string): Promise<string[]> {
  const rows = await db
    .select({ slug: skillDrafts.slug })
    .from(skillDrafts)
    .where(eq(skillDrafts.ownerId, ownerId));
  return rows.map((r) => r.slug);
}

export async function getDraftById(id: string): Promise<SkillDraft | null> {
  const rows = await db
    .select()
    .from(skillDrafts)
    .where(eq(skillDrafts.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSkillDraft(
  input: Omit<NewSkillDraft, "id" | "createdAt" | "status" | "reviewedAt"> & {
    status?: NewSkillDraft["status"];
  },
): Promise<SkillDraft> {
  const [row] = await db
    .insert(skillDrafts)
    .values({ ...input, id: nanoid() })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function markDraftReviewed(
  id: string,
  status: "approved" | "rejected",
): Promise<SkillDraft | null> {
  const [row] = await db
    .update(skillDrafts)
    .set({ status, reviewedAt: new Date() })
    .where(eq(skillDrafts.id, id))
    .returning();
  return row ?? null;
}

export async function deleteSkillDraft(id: string): Promise<void> {
  await db.delete(skillDrafts).where(eq(skillDrafts.id, id));
}

/** Owner-or-team-owner rights, mirroring skills authz (canEditSkill is
 *  owner-only, but drafts can be team-scoped like the source session). */
export function isDraftOwner(userId: string, draft: { ownerId: string }): boolean {
  return draft.ownerId === userId;
}
