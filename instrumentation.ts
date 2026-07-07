export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadEnv } = await import("@/lib/env");
  loadEnv();

  // Apply pending DB migrations before anything reads the schema. On a fresh
  // Dokploy database this is what creates the tables; on subsequent boots
  // it's a no-op. Failure here is fatal — bootstrap and the poller would
  // crash anyway with "relation does not exist" if the schema is missing.
  const { runMigrations } = await import("@/lib/db/migrate");
  try {
    await runMigrations();
  } catch (err) {
    console.error("[db] Migration failed — refusing to start:", err);
    throw err;
  }

  const { ensureAdminUser } = await import("@/lib/auth/bootstrap");
  await ensureAdminUser().catch((err) => {
    console.error("[auth] Admin bootstrap failed:", err);
  });

  // First-boot only: lift the file-based skills/ folder into the DB so the
  // operator can edit them in /skills. No-op once any skill row exists.
  const { seedSkillsFromFolderIfEmpty } = await import("@/lib/skills-seed");
  await seedSkillsFromFolderIfEmpty().catch((err) => {
    console.error("[skills] folder seed failed:", err);
  });

  const { startLinearPoller } = await import("@/lib/linear/poller");
  startLinearPoller();

  const { startWorkflowDispatcher } = await import(
    "@/lib/workflows/dispatcher"
  );
  startWorkflowDispatcher();

  // Generic daily agent schedules (absorbs the old scout nightly loop —
  // it seeds a "Nightly scout" schedule row per repo owner on first boot).
  const { startScheduler } = await import("@/lib/schedules/runner");
  startScheduler();

  // Auto skill library: after sessions go quiet, a cheap-model pass distills
  // reusable repo-specific procedures into skill drafts for operator review.
  const { startSkillDistiller } = await import("@/lib/skills/distiller");
  startSkillDistiller();

  // Event bus: fans pending events (agent-emitted + webhook-injected) out to
  // matching subscriptions, spawning a session per delivery.
  const { startEventDispatcher } = await import("@/lib/events/dispatcher");
  startEventDispatcher();
}
