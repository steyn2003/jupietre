"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type ButtonProps = Omit<HTMLMotionProps<"button">, "ref" | "children"> & {
  variant?: Variant;
  size?: Size;
  /** Optional trailing icon — rendered inside its own circular pill (button-in-button). */
  trailingIcon?: React.ReactNode;
  leadingIcon?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  children?: React.ReactNode;
};

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-strong shadow-[var(--shadow-soft)]",
  secondary:
    "bg-surface-1 text-fg border border-hairline hover:bg-surface-2 hover:border-strong",
  ghost: "bg-transparent text-fg-muted hover:text-fg hover:bg-surface-1",
  danger: "bg-danger-soft text-danger hover:bg-danger hover:text-white",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[10px]",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-[15px] gap-2.5 rounded-2xl",
};

const iconPillSize: Record<Size, string> = {
  sm: "h-5 w-5 -mr-1",
  md: "h-7 w-7 -mr-1.5",
  lg: "h-8 w-8 -mr-2",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      trailingIcon,
      leadingIcon,
      loading,
      fullWidth,
      disabled,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        disabled={disabled || loading}
        className={cn(
          "group relative inline-flex items-center justify-center font-medium",
          "transition-colors duration-200 ease-[var(--ease-spring)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
          sizeClasses[size],
          variantClasses[variant],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {leadingIcon ? (
          <span className="inline-flex shrink-0 items-center">{leadingIcon}</span>
        ) : null}
        <span className={cn(loading && "opacity-0")}>{children}</span>
        {trailingIcon ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full",
              "bg-black/15 dark:bg-white/10",
              "transition-transform duration-300 ease-[var(--ease-spring)]",
              "group-hover:translate-x-0.5 group-hover:-translate-y-px",
              iconPillSize[size],
            )}
          >
            {trailingIcon}
          </span>
        ) : null}
        {loading ? (
          <span className="absolute inset-0 inline-flex items-center justify-center">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </span>
        ) : null}
      </motion.button>
    );
  },
);
