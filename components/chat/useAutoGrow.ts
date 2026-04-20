"use client";

import { useEffect, useRef } from "react";

/**
 * Auto-grow a textarea from `minRows` to `maxRows` as the user types. Only
 * mutates `style.height` — no layout flush beyond the textarea itself.
 * Re-measures whenever `value` changes so external resets (e.g. clearing
 * the composer after send) collapse back to min height.
 */
export function useAutoGrow(
  value: string,
  { minRows = 1, maxRows = 8 }: { minRows?: number; maxRows?: number } = {},
) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    const lineHeight =
      parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
    const padding =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border =
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);

    const min = lineHeight * minRows + padding + border;
    const max = lineHeight * maxRows + padding + border;

    el.style.height = "auto";
    const next = Math.min(max, Math.max(min, el.scrollHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value, minRows, maxRows]);

  return ref;
}
