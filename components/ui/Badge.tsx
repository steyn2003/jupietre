import * as React from "react";
import { cn } from "./cn";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
type Size = "sm" | "md";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-muted border-hairline",
  accent: "bg-accent-soft text-accent border-[color:var(--accent-soft)]",
  success: "bg-success-soft text-success border-[color:var(--success-soft)]",
  warning: "bg-warning-soft text-warning border-[color:var(--warning-soft)]",
  danger: "bg-danger-soft text-danger border-[color:var(--danger-soft)]",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-5 px-1.5 text-[10px] gap-1 tracking-[0.04em]",
  md: "h-6 px-2 text-[11px] gap-1.5 tracking-[0.04em]",
};

export function Badge({
  tone = "neutral",
  size = "sm",
  dot,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  size?: Size;
  /** Show a leading status dot in the same tone. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium uppercase",
        sizeClasses[size],
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      ) : null}
      {children}
    </span>
  );
}

/**
 * Eyebrow tag — small uppercase tracking-heavy label that precedes major
 * headings to add hierarchy without scaling the H1.
 */
export function Eyebrow({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-hairline bg-surface-1",
        "px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-fg-muted font-medium",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
