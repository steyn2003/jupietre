/**
 * Token Pool Manager
 *
 * Manages multiple Claude Code OAuth tokens (or API keys) with:
 * - Round-robin rotation when a token hits its usage threshold
 * - Per-token cost tracking with configurable daily limits
 * - Status reporting for monitoring
 *
 * Configuration (env vars):
 *   CLAUDE_TOKENS=token1,token2,token3          (comma-separated OAuth tokens or API keys)
 *   CLAUDE_TOKEN_TYPE=oauth|apikey               (default: oauth)
 *   CLAUDE_TOKEN_DAILY_LIMIT_USD=50              (per-token daily spend limit in USD)
 *   CLAUDE_TOKEN_THRESHOLD=0.8                   (switch to next token at this % of limit, default 80%)
 *
 * Falls back to single CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY if CLAUDE_TOKENS is not set.
 */

export interface TokenUsage {
  token: string;
  /** Masked version for logging */
  masked: string;
  /** Total USD spent today */
  costToday: number;
  /** Timestamp of last reset (start of day) */
  resetAt: number;
  /** Whether this token is currently exhausted (past threshold) */
  exhausted: boolean;
}

const TOKEN_TYPE = (process.env.CLAUDE_TOKEN_TYPE ?? "oauth") as "oauth" | "apikey";
const DAILY_LIMIT_USD = Number(process.env.CLAUDE_TOKEN_DAILY_LIMIT_USD) || 50;
const THRESHOLD = Number(process.env.CLAUDE_TOKEN_THRESHOLD) || 0.8;
const EFFECTIVE_LIMIT = DAILY_LIMIT_USD * THRESHOLD;

function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return token.slice(0, 8) + "..." + token.slice(-4);
}

function startOfDay(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

class TokenPool {
  private tokens: TokenUsage[] = [];
  private currentIndex = 0;
  private initialized = false;

  /**
   * Initialize the pool from environment variables.
   * Safe to call multiple times — only initializes once.
   */
  init(): void {
    if (this.initialized) return;

    const raw = process.env.CLAUDE_TOKENS;
    if (raw) {
      const tokenList = raw.split(",").map((t) => t.trim()).filter(Boolean);
      if (tokenList.length === 0) {
        throw new Error("CLAUDE_TOKENS is set but contains no valid tokens");
      }
      this.tokens = tokenList.map((token) => ({
        token,
        masked: maskToken(token),
        costToday: 0,
        resetAt: startOfDay(),
        exhausted: false,
      }));
      console.log(
        `[token-pool] Initialized with ${this.tokens.length} tokens ` +
        `(type=${TOKEN_TYPE}, limit=$${DAILY_LIMIT_USD}/day, threshold=${THRESHOLD * 100}%)`,
      );
    } else {
      // Fallback: use single token from existing env vars
      const single =
        process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
      if (!single) {
        throw new Error(
          "No tokens configured. Set CLAUDE_TOKENS (multi) or CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY (single)",
        );
      }
      this.tokens = [
        {
          token: single,
          masked: maskToken(single),
          costToday: 0,
          resetAt: startOfDay(),
          exhausted: false,
        },
      ];
      console.log(`[token-pool] Using single token (${TOKEN_TYPE})`);
    }

    this.initialized = true;
  }

  /** Reset daily counters if we've crossed midnight */
  private maybeResetDaily(): void {
    const today = startOfDay();
    for (const t of this.tokens) {
      if (t.resetAt < today) {
        console.log(`[token-pool] Daily reset for token ${t.masked} ($${t.costToday.toFixed(2)} spent yesterday)`);
        t.costToday = 0;
        t.exhausted = false;
        t.resetAt = today;
      }
    }
  }

  /**
   * Get the next available token. Rotates away from exhausted tokens.
   * Returns null if ALL tokens are exhausted.
   */
  acquire(): TokenUsage | null {
    this.maybeResetDaily();

    // Try current, then rotate through all tokens
    for (let i = 0; i < this.tokens.length; i++) {
      const idx = (this.currentIndex + i) % this.tokens.length;
      const t = this.tokens[idx];
      if (!t.exhausted) {
        this.currentIndex = idx;
        return t;
      }
    }

    console.warn(
      `[token-pool] All ${this.tokens.length} tokens exhausted! ` +
      `Resets at midnight. Current usage: ${this.tokens.map((t) => `${t.masked}=$${t.costToday.toFixed(2)}`).join(", ")}`,
    );
    return null;
  }

  /**
   * Record cost spent by a token after an agent session.
   * Marks token as exhausted if it crosses the threshold.
   */
  recordUsage(token: TokenUsage, costUsd: number): void {
    token.costToday += costUsd;

    const pct = (token.costToday / DAILY_LIMIT_USD) * 100;
    console.log(
      `[token-pool] Token ${token.masked}: $${token.costToday.toFixed(2)}/$${DAILY_LIMIT_USD} (${pct.toFixed(1)}%)`,
    );

    if (token.costToday >= EFFECTIVE_LIMIT) {
      token.exhausted = true;
      console.log(
        `[token-pool] Token ${token.masked} hit ${THRESHOLD * 100}% threshold ($${token.costToday.toFixed(2)}/$${DAILY_LIMIT_USD}), rotating to next token`,
      );
      // Advance to next token for future calls
      this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
    }
  }

  /**
   * Apply the given token to the environment so the Agent SDK picks it up.
   */
  applyToEnv(token: TokenUsage): void {
    if (TOKEN_TYPE === "oauth") {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = token.token;
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = token.token;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
  }

  /**
   * Check if any token is available for work.
   */
  hasAvailableToken(): boolean {
    this.maybeResetDaily();
    return this.tokens.some((t) => !t.exhausted);
  }

  /**
   * Get a status summary for logging/monitoring.
   */
  getStatus(): string {
    this.maybeResetDaily();
    const lines = this.tokens.map((t, i) => {
      const pct = (t.costToday / DAILY_LIMIT_USD) * 100;
      const marker = i === this.currentIndex ? " ← active" : "";
      const status = t.exhausted ? " [EXHAUSTED]" : "";
      return `  ${t.masked}: $${t.costToday.toFixed(2)}/$${DAILY_LIMIT_USD} (${pct.toFixed(1)}%)${status}${marker}`;
    });
    return `[token-pool] Status:\n${lines.join("\n")}`;
  }

  /** Total tokens in the pool */
  get size(): number {
    return this.tokens.length;
  }

  /** Total spent across all tokens today */
  get totalSpentToday(): number {
    return this.tokens.reduce((sum, t) => sum + t.costToday, 0);
  }

  /** Total daily budget across all tokens */
  get totalBudget(): number {
    return this.tokens.length * DAILY_LIMIT_USD;
  }
}

/** Singleton token pool instance */
export const tokenPool = new TokenPool();
