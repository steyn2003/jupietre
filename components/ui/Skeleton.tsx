import * as React from "react";
import { cn } from "./cn";

/**
 * Skeleton placeholder with a shimmer sweep. Match its dimensions to the
 * real content's bounding box — never use a generic spinner where structure
 * is known. Keyframes live in globals.css.
 */
export function Skeleton({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-md bg-surface-2",
        "after:absolute after:inset-0 after:-translate-x-full",
        "after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)]",
        "after:animate-[shimmer_1.6s_ease-in-out_infinite]",
        className,
      )}
      {...rest}
    />
  );
}
