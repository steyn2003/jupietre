import * as React from "react";
import { cn } from "./cn";

export type Stat = {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Optional small caption beneath the value (e.g. "vs. last week"). */
  caption?: React.ReactNode;
  /** Optional trailing slot — sparkline, badge, etc. */
  trailing?: React.ReactNode;
};

/**
 * Replaces the generic 3-up StatCard grid. Stats sit in a single divided
 * row — they breathe via spacing, not boxes. Use inside a Card or alone.
 */
export function StatRow({
  stats,
  className,
}: {
  stats: Stat[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        "divide-y sm:divide-y-0 sm:divide-x divide-hairline",
        "rounded-2xl ring-1 ring-hairline bg-surface-1/60",
        className,
      )}
    >
      {stats.map((s, i) => (
        <div key={i} className="px-6 py-5 flex flex-col gap-1.5 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle font-medium">
            {s.label}
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="text-2xl font-medium text-fg tracking-tight font-mono tabular-nums truncate">
              {s.value}
            </div>
            {s.trailing ? <div className="shrink-0">{s.trailing}</div> : null}
          </div>
          {s.caption ? (
            <div className="text-[12px] text-fg-muted">{s.caption}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
