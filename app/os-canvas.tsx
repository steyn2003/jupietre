"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { CornersOutIcon, RobotIcon } from "@phosphor-icons/react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import ControlCanvas3D, {
  type ControlCanvas3DHandle,
  type ScenePick,
} from "./control-canvas-3d";
import { AgentInspector } from "./agent-inspector";
import type { GraphDTO } from "./os-graph-types";

// ────────────────────────────────────────────────────────────────────
// The Control canvas — a live 3D map of the whole workspace: triggers
// (back/left) → agents (center) → resources (front/right), with running
// sessions lighting up the wiring. This file stays the orchestrator:
// polling /api/os/graph every 5s (skipping when the tab is hidden),
// selection state, legend, empty state, and the agent inspector panel.
// Rendering lives in control-canvas-3d.tsx (raw three.js).
// ────────────────────────────────────────────────────────────────────

const LEGEND = [
  ["Agent", "#5b8def"],
  ["Trigger", "#a855f7"],
  ["Event", "#8b5cf6"],
  ["Connection", "#2dd4bf"],
  ["Repo", "#c9a173"],
  ["Live", "#3b82f6"],
] as const;

export function OsCanvas() {
  const router = useRouter();
  const [data, setData] = useState<GraphDTO | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvasRef = useRef<ControlCanvas3DHandle>(null);

  // Latest graph, readable from stable callbacks without re-binding them
  // every poll (keeps the 3D component's props referentially calm).
  const dataRef = useRef<GraphDTO | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const load = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/os/graph");
      if (!res.ok) return;
      setData((await res.json()) as GraphDTO);
    } catch {
      // transient — next poll retries
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const onPick = useCallback(
    (pick: ScenePick) => {
      switch (pick.kind) {
        case "agent":
          setSelectedId(pick.id);
          return;
        case "repo":
          router.push("/repos");
          return;
        case "connection":
          router.push("/connections");
          return;
        case "subscription":
        case "webhook":
          router.push("/events");
          return;
        case "trigger": {
          const t = dataRef.current?.triggers.find((x) => x.id === pick.id);
          if (t) router.push(t.href);
          return;
        }
      }
    },
    [router],
  );

  const onBackgroundClick = useCallback(() => setSelectedId(null), []);

  const selectedAgent = useMemo(
    () => data?.agents.find((a) => a.id === selectedId) ?? null,
    [data, selectedId],
  );
  const selectedSessions = useMemo(
    () =>
      selectedId
        ? (data?.recentSessions.filter((s) => s.agentConfigId === selectedId) ?? [])
        : [],
    [data, selectedId],
  );

  if (data && data.agents.length === 0) {
    return (
      <EmptyState
        icon={<RobotIcon weight="regular" className="h-5 w-5" />}
        title="No agents yet"
        description="Your control plane lights up once you have agents. Install one from the market or build your own to get started."
        action={
          <div className="flex gap-2">
            <Link href="/market">
              <Button>Browse market</Button>
            </Link>
            <Link href="/agents">
              <Button variant="secondary">Create agent</Button>
            </Link>
          </div>
        }
      />
    );
  }

  return (
    <div className="relative">
      <div
        style={{
          height: "clamp(480px, 72vh, 900px)",
          borderRadius: 16,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, var(--surface-1, rgba(0,0,0,0.02)) 0%, transparent 100%)",
        }}
        className="relative ring-1 ring-hairline"
      >
        {data ? (
          <ControlCanvas3D
            ref={canvasRef}
            data={data}
            selectedId={selectedId}
            onPick={onPick}
            onBackgroundClick={onBackgroundClick}
            className="absolute inset-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-fg-subtle">
            Loading control plane…
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 z-[5] flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            type="button"
            onClick={() => canvasRef.current?.resetView()}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-surface-1/80 px-2.5 py-1 text-[11px] text-fg-muted ring-1 ring-hairline backdrop-blur hover:text-fg"
          >
            <CornersOutIcon weight="bold" className="h-3 w-3" />
            Reset view
          </button>
          {LEGEND.map(([label, color]) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 text-[10px] text-fg-subtle"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: color }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selectedAgent ? (
          <AgentInspector
            key={selectedAgent.id}
            agent={selectedAgent}
            sessions={selectedSessions}
            connections={data?.connections ?? []}
            grantedConnectionIds={
              (data?.grantEdges ?? [])
                .filter((g) => g.agentConfigId === selectedAgent.id)
                .map((g) => g.connectionId)
            }
            onClose={() => setSelectedId(null)}
            onPatched={() => void load()}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
