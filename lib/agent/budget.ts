import "server-only";
import type { AgentConfig } from "@/lib/db/agent-configs";
import {
  getAgentSpendWindow,
  microUsdToUsd,
  usdToMicro,
} from "@/lib/db/usage";

export interface BudgetDecision {
  allowed: boolean;
  reason?: string;
  window?: "day" | "month";
  spendUsd?: number;
  capUsd?: number;
}

/**
 * Gate session starts on an agent's rolling daily / monthly cap.
 * `maxBudgetUsd` (per-session) is enforced by the SDK itself.
 */
export async function canStartSession(
  config: AgentConfig,
): Promise<BudgetDecision> {
  if (config.dailyBudgetUsd !== null && config.dailyBudgetUsd !== undefined) {
    const spent = await getAgentSpendWindow(config.id, "day");
    const cap = usdToMicro(config.dailyBudgetUsd);
    if (spent >= cap) {
      return {
        allowed: false,
        window: "day",
        spendUsd: microUsdToUsd(spent),
        capUsd: config.dailyBudgetUsd,
        reason: `Daily budget of $${config.dailyBudgetUsd} exceeded (spent $${microUsdToUsd(
          spent,
        ).toFixed(2)}).`,
      };
    }
  }
  if (
    config.monthlyBudgetUsd !== null &&
    config.monthlyBudgetUsd !== undefined
  ) {
    const spent = await getAgentSpendWindow(config.id, "month");
    const cap = usdToMicro(config.monthlyBudgetUsd);
    if (spent >= cap) {
      return {
        allowed: false,
        window: "month",
        spendUsd: microUsdToUsd(spent),
        capUsd: config.monthlyBudgetUsd,
        reason: `Monthly budget of $${config.monthlyBudgetUsd} exceeded (spent $${microUsdToUsd(
          spent,
        ).toFixed(2)}).`,
      };
    }
  }
  return { allowed: true };
}
