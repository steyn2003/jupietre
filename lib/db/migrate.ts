import "server-only";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

let migrated = false;

/**
 * Apply pending Drizzle migrations against the configured Postgres. Idempotent
 * across boots — drizzle records what's been applied in __drizzle_migrations__.
 *
 * Called once on app startup (instrumentation.ts) before anything reads the DB.
 * Uses a dedicated short-lived `max: 1` connection so the pool used by the
 * rest of the app isn't blocked while DDL runs.
 */
export async function runMigrations(): Promise<void> {
  if (migrated) return;
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.warn("[db] POSTGRES_URL not set — skipping migrations");
    return;
  }

  const sql = postgres(url, { max: 1 });
  try {
    const folder = path.join(process.cwd(), "lib", "db", "migrations");
    await migrate(drizzle(sql), { migrationsFolder: folder });
    migrated = true;
    console.log("[db] migrations applied");
  } finally {
    await sql.end({ timeout: 5 });
  }
}
