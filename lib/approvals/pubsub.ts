import "server-only";

export type ApprovalDecision =
  | { status: "approved" }
  | { status: "denied"; reason?: string };

type Resolver = (decision: ApprovalDecision) => void;

interface PubSubState {
  pending: Map<string, Resolver>;
}

const state: PubSubState = (() => {
  const g = globalThis as unknown as { __jupietreApprovals?: PubSubState };
  if (!g.__jupietreApprovals) g.__jupietreApprovals = { pending: new Map() };
  return g.__jupietreApprovals;
})();

export function waitForDecision(
  approvalId: string,
  timeoutMs: number,
): Promise<ApprovalDecision | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.pending.delete(approvalId);
      resolve("timeout");
    }, timeoutMs);

    state.pending.set(approvalId, (decision) => {
      clearTimeout(timer);
      state.pending.delete(approvalId);
      resolve(decision);
    });
  });
}

/** Returns true if a waiter was awakened, false if no one was listening. */
export function publishDecision(
  approvalId: string,
  decision: ApprovalDecision,
): boolean {
  const resolver = state.pending.get(approvalId);
  if (!resolver) return false;
  resolver(decision);
  return true;
}
