"use client";

import dynamic from "next/dynamic";
import type { AgentConstellationProps } from "./AgentConstellation";

/**
 * Client-only mount point for the WebGL agent constellation.
 *
 * The scene touches `window`/WebGL, so it can never server-render. Next 16
 * forbids `ssr: false` inside a Server Component, so the dynamic import is
 * isolated here in a Client Component — Server Components (the login page,
 * /work) import this wrapper directly. `three` therefore only enters the
 * bundle on routes that actually render it.
 */
const AgentConstellation = dynamic(() => import("./AgentConstellation"), {
  ssr: false,
});

export function ConstellationBackground(props: AgentConstellationProps) {
  return <AgentConstellation {...props} />;
}
