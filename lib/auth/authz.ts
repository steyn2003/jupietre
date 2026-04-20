import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentConfigs,
  repos,
  sessions,
  teamMembers,
} from "@/lib/db/schema";

/**
 * The single source of truth for "what can this user see?".
 *
 * Two visibility planes:
 *  - **session.visibility = "private"** → only the owner.
 *  - **session.visibility = "team" + session.teamId set** → any team member.
 *
 * Agents:
 *  - **agent.userId == me** → mine; full read/write/delete.
 *  - **agent.teamId set + I'm in that team** → read + use; only team owners can edit/delete.
 */

export async function getMyTeamIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return rows.map((r) => r.teamId);
}

export async function isTeamOwner(
  userId: string,
  teamId: string,
): Promise<boolean> {
  const rows = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
    )
    .limit(1);
  return rows[0]?.role === "owner";
}

export interface SessionACL {
  ownerId: string | null;
  visibility: "private" | "team";
  teamId: string | null;
}

export function canReadSession(userId: string, s: SessionACL, myTeamIds: Set<string>): boolean {
  if (s.ownerId === userId) return true;
  if (s.visibility === "team" && s.teamId && myTeamIds.has(s.teamId)) return true;
  return false;
}

export function canWriteSession(userId: string, s: SessionACL, myTeamIds: Set<string>): boolean {
  // Same rule for now — anyone who can read can also send messages. Tighten
  // later if we add observer roles.
  return canReadSession(userId, s, myTeamIds);
}

export interface AgentACL {
  userId: string;
  teamId: string | null;
}

/** Read & use the agent in new sessions. */
export function canUseAgent(
  userId: string,
  a: AgentACL,
  myTeamIds: Set<string>,
): boolean {
  if (a.userId === userId) return true;
  if (a.teamId && myTeamIds.has(a.teamId)) return true;
  return false;
}

/**
 * Edit/delete the agent. Owner-only:
 *   - own private agent: the user themselves
 *   - team agent: a team owner
 */
export async function canEditAgent(
  userId: string,
  a: AgentACL,
): Promise<boolean> {
  if (a.userId === userId && a.teamId === null) return true;
  if (a.teamId) return isTeamOwner(userId, a.teamId);
  return false;
}

/** Visible session ids for a user (owned or team-readable). */
export function visibleSessionsWhere(userId: string, myTeamIds: string[]) {
  if (myTeamIds.length === 0) {
    return or(eq(sessions.ownerId, userId), eq(sessions.userId, userId));
  }
  return or(
    eq(sessions.ownerId, userId),
    eq(sessions.userId, userId),
    and(
      eq(sessions.visibility, "team"),
      inArray(sessions.teamId, myTeamIds),
    ),
  );
}

/** Visible agents for a user (owned + any team agent the user is part of). */
export function visibleAgentsWhere(userId: string, myTeamIds: string[]) {
  if (myTeamIds.length === 0) {
    return eq(agentConfigs.userId, userId);
  }
  return or(
    eq(agentConfigs.userId, userId),
    inArray(agentConfigs.teamId, myTeamIds),
  );
}

export interface RepoACL {
  userId: string;
  teamId: string | null;
}

/** Read & use the repo when starting new sessions. */
export function canUseRepo(
  userId: string,
  r: RepoACL,
  myTeamIds: Set<string>,
): boolean {
  if (r.userId === userId) return true;
  if (r.teamId && myTeamIds.has(r.teamId)) return true;
  return false;
}

/** Edit/delete the repo (which removes the on-disk clone). Owner-only. */
export async function canEditRepo(
  userId: string,
  r: RepoACL,
): Promise<boolean> {
  if (r.userId === userId && r.teamId === null) return true;
  if (r.teamId) return isTeamOwner(userId, r.teamId);
  return false;
}

/** Visible repos for a user (owned + any team repo the user is part of). */
export function visibleReposWhere(userId: string, myTeamIds: string[]) {
  if (myTeamIds.length === 0) return eq(repos.userId, userId);
  return or(eq(repos.userId, userId), inArray(repos.teamId, myTeamIds));
}

/** Convenience for routes — load + decide in one call. Returns null on no-access. */
export async function loadReadableSession(sessionId: string, userId: string) {
  const myTeamIds = await getMyTeamIds(userId);
  const myTeamSet = new Set(myTeamIds);
  const row = (
    await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
  )[0];
  if (!row) return null;
  if (
    !canReadSession(
      userId,
      {
        ownerId: row.ownerId,
        visibility: row.visibility,
        teamId: row.teamId,
      },
      myTeamSet,
    )
  ) {
    return null;
  }
  return row;
}

/** Just so callers don't have to drag `sql` in for `coalesce(owner_id, user_id)`. */
export const ownerIdExpr = sql<string>`COALESCE(${sessions.ownerId}, ${sessions.userId})`;
