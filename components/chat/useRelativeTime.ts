"use client";

import { useEffect, useState } from "react";

/**
 * Format a past timestamp as "just now" / "2m ago" / "3h ago" / "2d ago" /
 * "Mar 4". Re-renders on a coarse interval so bubbles don't stale.
 */
export function useRelativeTime(iso: string): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return format(now - new Date(iso).getTime(), iso);
}

function format(deltaMs: number, iso: string): string {
  const sec = Math.max(0, Math.round(deltaMs / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
