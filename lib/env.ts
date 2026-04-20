import "server-only";
import { z } from "zod";

/**
 * Required process env, validated at boot from `instrumentation.ts`.
 * Anything optional belongs to a feature flag — keep this list lean so a
 * misconfigured deploy fails loudly instead of crashing on the first
 * request.
 */
const schema = z.object({
  POSTGRES_URL: z.string().url(),
  JWE_SECRET: z
    .string()
    .min(1, "JWE_SECRET must be set (32 bytes base64url; openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\\n')"),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  /** Public URL the app is served from, e.g. https://jupietre.example.com */
  APP_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | null = null;

/**
 * Validate process env. In production any failure exits the process.
 * In development we log + continue so `bun run dev` against an
 * incomplete `.env` is still usable.
 */
export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    const message = `Environment validation failed:\n${issues}`;
    if (process.env.NODE_ENV === "production") {
      console.error(message);
      process.exit(1);
    } else {
      console.warn(`[env] ${message}\n[env] Continuing in development mode.`);
      // Best-effort partial result so callers don't blow up.
      cached = {
        ...(process.env as unknown as AppEnv),
        NODE_ENV: (process.env.NODE_ENV as AppEnv["NODE_ENV"]) ?? "development",
      };
      return cached;
    }
  }
  cached = parsed.data;
  return cached;
}

export function getEnv(): AppEnv {
  if (!cached) return loadEnv();
  return cached;
}
