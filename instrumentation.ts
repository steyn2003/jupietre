export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadEnv } = await import("@/lib/env");
  loadEnv();

  const { ensureAdminUser } = await import("@/lib/auth/bootstrap");
  await ensureAdminUser().catch((err) => {
    console.error("[auth] Admin bootstrap failed:", err);
  });

  const { startLinearPoller } = await import("@/lib/linear/poller");
  startLinearPoller();
}
