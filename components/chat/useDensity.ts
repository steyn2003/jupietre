"use client";

import { useEffect, useState } from "react";

export type Density = "compact" | "comfortable";
const KEY = "jupietre:chat-density";

/**
 * Chat density preference, persisted to localStorage. Default = comfortable.
 * The hook reads sync on mount (no hydration flash past the first paint) and
 * writes every change back to storage.
 */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>("comfortable");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY);
      if (stored === "compact" || stored === "comfortable") setDensity(stored);
    } catch {
      // localStorage can throw in sandboxed iframes — fall back to default
    }
  }, []);

  const set = (d: Density) => {
    setDensity(d);
    try {
      window.localStorage.setItem(KEY, d);
    } catch {
      // ignore
    }
  };

  return [density, set];
}
