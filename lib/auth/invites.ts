import "server-only";
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { invites, teamMembers, users } from "@/lib/db/schema";
import { hashPassword } from "./password";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type Invite = typeof invites.$inferSelect;

interface CreateInviteInput {
  email: string;
  invitedBy: string;
  teamId?: string | null;
  teamRole?: "owner" | "member";
  ttlMs?: number;
}

export async function createInvite(
  input: CreateInviteInput,
): Promise<Invite> {
  const token = crypto.randomBytes(24).toString("base64url");
  const id = nanoid();
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS));
  const [row] = await db
    .insert(invites)
    .values({
      id,
      email: input.email.toLowerCase(),
      teamId: input.teamId ?? null,
      teamRole: input.teamRole ?? "member",
      token,
      invitedBy: input.invitedBy,
      expiresAt,
    })
    .returning();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function getInviteByToken(token: string): Promise<Invite | null> {
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.token, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function listInvitesByTeam(teamId: string): Promise<Invite[]> {
  return db
    .select()
    .from(invites)
    .where(and(eq(invites.teamId, teamId), isNull(invites.consumedAt)));
}

export async function listInvitesByInviter(userId: string): Promise<Invite[]> {
  return db
    .select()
    .from(invites)
    .where(and(eq(invites.invitedBy, userId), isNull(invites.consumedAt)));
}

export async function revokeInvite(id: string): Promise<void> {
  await db.delete(invites).where(eq(invites.id, id));
}

export interface RedeemInput {
  token: string;
  password: string;
  displayName?: string | null;
}

export interface RedeemResult {
  userId: string;
  email: string;
}

/**
 * Atomically: verify the invite, create the user (or reject if email already
 * registered — they should sign in), join the team, mark invite consumed.
 */
export async function redeemInvite(
  input: RedeemInput,
): Promise<RedeemResult> {
  const invite = await getInviteByToken(input.token);
  if (!invite) throw new Error("Invite not found");
  if (invite.consumedAt) throw new Error("Invite already used");
  if (invite.expiresAt < new Date()) throw new Error("Invite expired");

  // Email collision: refuse here. Users joining a team they've already signed
  // up for is M7 territory (sharing).
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, invite.email))
    .limit(1);
  if (existing.length > 0) {
    throw new Error("Email already registered — sign in and ask the team owner to add you directly.");
  }

  const userId = nanoid();
  await db.insert(users).values({
    id: userId,
    email: invite.email,
    passwordHash: hashPassword(input.password),
    displayName: input.displayName?.trim() || null,
    isAdmin: 0, // invitees are not admins by default
  });

  if (invite.teamId) {
    await db.insert(teamMembers).values({
      teamId: invite.teamId,
      userId,
      role: invite.teamRole,
    });
  }

  await db
    .update(invites)
    .set({ consumedAt: new Date() })
    .where(eq(invites.id, invite.id));

  return { userId, email: invite.email };
}

/** Build the absolute accept URL using APP_URL from env. */
export function buildInviteUrl(token: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/invite/${token}`;
}
