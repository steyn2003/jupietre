import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { teamMembers, teams, users } from "./schema";

export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;

export interface TeamMemberRow extends TeamMember {
  email: string;
  displayName: string | null;
}

export async function createTeam(name: string, ownerId: string): Promise<Team> {
  const id = nanoid();
  const [row] = await db
    .insert(teams)
    .values({ id, name, createdBy: ownerId })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  await db.insert(teamMembers).values({
    teamId: id,
    userId: ownerId,
    role: "owner",
  });
  return row;
}

export async function listTeamsForUser(userId: string): Promise<Team[]> {
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      createdBy: teams.createdBy,
      createdAt: teams.createdAt,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId));
  return rows;
}

export async function listMembers(teamId: string): Promise<TeamMemberRow[]> {
  return db
    .select({
      teamId: teamMembers.teamId,
      userId: teamMembers.userId,
      role: teamMembers.role,
      addedAt: teamMembers.addedAt,
      email: users.email,
      displayName: users.displayName,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId));
}

export async function removeMember(
  teamId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
    );
}

export async function getTeamMember(
  teamId: string,
  userId: string,
): Promise<TeamMember | null> {
  const rows = await db
    .select()
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}
