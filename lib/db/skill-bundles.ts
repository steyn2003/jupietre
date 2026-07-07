import "server-only";
import { eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { skillBundles } from "./schema";

export type SkillBundle = typeof skillBundles.$inferSelect;
type NewSkillBundle = typeof skillBundles.$inferInsert;

export async function listVisibleSkillBundles(
  ownerId: string,
  myTeamIds: string[],
): Promise<SkillBundle[]> {
  if (myTeamIds.length === 0) {
    return db
      .select()
      .from(skillBundles)
      .where(eq(skillBundles.ownerId, ownerId));
  }
  return db
    .select()
    .from(skillBundles)
    .where(
      or(
        eq(skillBundles.ownerId, ownerId),
        inArray(skillBundles.teamId, myTeamIds),
      ),
    );
}

export async function getSkillBundleById(
  id: string,
): Promise<SkillBundle | null> {
  const rows = await db
    .select()
    .from(skillBundles)
    .where(eq(skillBundles.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSkillBundle(
  input: Omit<NewSkillBundle, "id" | "createdAt" | "updatedAt">,
): Promise<SkillBundle> {
  const id = nanoid();
  const [row] = await db
    .insert(skillBundles)
    .values({ ...input, id })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updateSkillBundle(
  id: string,
  patch: Partial<Omit<NewSkillBundle, "id" | "ownerId" | "slug" | "createdAt">>,
): Promise<SkillBundle | null> {
  const [row] = await db
    .update(skillBundles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(skillBundles.id, id))
    .returning();
  return row ?? null;
}

export async function deleteSkillBundle(id: string): Promise<void> {
  await db.delete(skillBundles).where(eq(skillBundles.id, id));
}

export function canEditSkillBundle(
  userId: string,
  bundle: { ownerId: string },
): boolean {
  return bundle.ownerId === userId;
}
