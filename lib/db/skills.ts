import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { skills } from "./schema";

export type Skill = typeof skills.$inferSelect;
type NewSkill = typeof skills.$inferInsert;

export async function listVisibleSkills(
  ownerId: string,
  myTeamIds: string[],
): Promise<Skill[]> {
  if (myTeamIds.length === 0) {
    return db.select().from(skills).where(eq(skills.ownerId, ownerId));
  }
  return db
    .select()
    .from(skills)
    .where(
      or(eq(skills.ownerId, ownerId), inArray(skills.teamId, myTeamIds)),
    );
}

export async function listMyOwnSkills(ownerId: string): Promise<Skill[]> {
  return db.select().from(skills).where(eq(skills.ownerId, ownerId));
}

export async function getSkillById(id: string): Promise<Skill | null> {
  const rows = await db
    .select()
    .from(skills)
    .where(eq(skills.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSkillBySlug(
  ownerId: string,
  slug: string,
): Promise<Skill | null> {
  const rows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.ownerId, ownerId), eq(skills.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSkill(
  input: Omit<NewSkill, "id" | "createdAt" | "updatedAt">,
): Promise<Skill> {
  const id = nanoid();
  const [row] = await db
    .insert(skills)
    .values({ ...input, id })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function updateSkill(
  id: string,
  patch: Partial<Omit<NewSkill, "id" | "ownerId" | "slug" | "createdAt">>,
): Promise<Skill | null> {
  const [row] = await db
    .update(skills)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(skills.id, id))
    .returning();
  return row ?? null;
}

export async function deleteSkill(id: string): Promise<void> {
  await db.delete(skills).where(eq(skills.id, id));
}

export function canEditSkill(
  userId: string,
  skill: { ownerId: string },
): boolean {
  return skill.ownerId === userId;
}

export async function skillsTableHasRows(): Promise<boolean> {
  const rows = await db.select({ id: skills.id }).from(skills).limit(1);
  return rows.length > 0;
}
