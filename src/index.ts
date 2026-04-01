import { loadRole } from "./roles/index.js";
import { initTracing } from "./lib/tracing.js";
import { tokenPool } from "./lib/token-pool.js";
import { startPoller } from "./poller.js";

async function main() {
  const role = loadRole();
  console.log(`Starting agent: ${role.displayName} (${role.name})`);

  initTracing();
  tokenPool.init();
  startPoller(role);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
