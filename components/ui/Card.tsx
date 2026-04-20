import * as React from "react";
import { cn } from "./cn";

/**
 * Double-bezel card. Outer shell holds a hairline ring + tinted padding;
 * inner core has its own surface, inner highlight, and concentric radius.
 * This is the only "card" primitive — use `bare` to skip the inner pad
 * for cards that contain their own padded sections (e.g. divide-y rows).
 */
type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  bare?: boolean;
  /** Use a flat single-surface card (no double-bezel) for low-emphasis groupings. */
  flat?: boolean;
  /** Add diffused depth shadow — reserve for cards that should pop off the page. */
  elevated?: boolean;
};

export function Card({
  className,
  children,
  bare = false,
  flat = false,
  elevated = false,
  ...rest
}: CardProps) {
  if (flat) {
    return (
      <div
        className={cn(
          "rounded-xl border border-hairline bg-surface-1",
          !bare && "p-5",
          elevated && "shadow-[var(--shadow-soft)]",
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "rounded-2xl bg-surface-1/60 ring-1 ring-hairline p-1.5",
        elevated && "shadow-[var(--shadow-soft)]",
        className,
      )}
      {...rest}
    >
      <div
        className={cn(
          "rounded-[calc(var(--radius-2xl)-6px)] bg-surface-1",
          "shadow-[var(--shadow-inset-hi)]",
          !bare && "p-5",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 mb-4", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-fg tracking-tight">{title}</h3>
        {description ? (
          <p className="text-[13px] text-fg-muted mt-1 leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
