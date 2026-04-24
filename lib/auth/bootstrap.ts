import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { ensureBuiltInAgentConfigs } from "@/lib/db/agent-configs";
import { ensureBuiltInWorkflows } from "@/lib/workflows/runs";
import { seedReposFromEnv } from "@/lib/repos/manager";
import { hashPassword } from "./password";

let bootstrapped = false;

/**
 * On first boot, create an admin user from ADMIN_EMAIL + ADMIN_PASSWORD env vars.
 * Also seeds the built-in agent configs (idempotent across boots).
 */
export async function ensureAdminUser(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  if (existing.length > 0) {
    userId = existing[0]!.id;
  } else {
    const id = nanoid();
    await db.insert(users).values({
      id,
      email,
      passwordHash: hashPassword(password),
      isAdmin: 1,
    });
    userId = id;
    console.log(`[auth] Bootstrapped admin user: ${email}`);
  }

  await ensureBuiltInAgentConfigs(userId);
  await ensureBuiltInWorkflows(userId);

  // Seed repos from GITHUB_REPOS env in the background — clones can take
  // seconds and we don't want to block the request that triggered bootstrap.
  void seedReposFromEnv(userId).catch((err) => {
    console.warn("[repos] Background seed failed:", err);
  });
}
