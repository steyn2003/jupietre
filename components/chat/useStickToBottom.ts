"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Stick a scroll container to its bottom while new content arrives, *unless*
 * the user has scrolled up. Returns `{ ref, atBottom, scrollToBottom }` so
 * the consumer can render a floating "jump to latest" pill when atBottom
 * is false. Threshold is 48px — small enough that a nudge still counts as
 * "at bottom", big enough to handle inertial scrolling.
 */
export function useStickToBottom<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const [atBottom, setAtBottom] = useState(true);

  // autoscroll on new content — but only if user was already at bottom
  useEffect(() => {
    const el = ref.current;
    if (!el || !atBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [dep, atBottom]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtBottom(distance < 48);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  return { ref, atBottom, scrollToBottom };
}
