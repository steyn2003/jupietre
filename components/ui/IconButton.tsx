"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "./cn";

type Variant = "ghost" | "surface" | "accent";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  ghost: "bg-transparent text-fg-muted hover:text-fg hover:bg-surface-1",
  surface:
    "bg-surface-1 text-fg-muted ring-1 ring-hairline hover:text-fg hover:bg-surface-2",
  accent: "bg-accent-soft text-accent hover:bg-accent hover:text-accent-fg",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-7 w-7 rounded-lg [&_svg]:h-3.5 [&_svg]:w-3.5",
  md: "h-9 w-9 rounded-xl [&_svg]:h-4 [&_svg]:w-4",
  lg: "h-11 w-11 rounded-2xl [&_svg]:h-5 [&_svg]:w-5",
};

type IconButtonProps = Omit<HTMLMotionProps<"button">, "ref" | "children"> & {
  variant?: Variant;
  size?: Size;
  children?: React.ReactNode;
  /** Required — IconButtons must be screen-reader labeled. */
  "aria-label": string;
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { variant = "ghost", size = "md", className, children, ...rest },
    ref,
  ) {
    return (
      <motion.button
        ref={ref}
        type="button"
        whileTap={{ scale: 0.92 }}
        transition={{ type: "spring", stiffness: 500, damping: 28 }}
        className={cn(
          "inline-flex items-center justify-center transition-colors duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          sizeClasses[size],
          variantClasses[variant],
          className,
        )}
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);
