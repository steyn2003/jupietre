"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

// ────────────────────────────────────────────────────────────────────
// Inputs (passed from the server page). We keep these tight to plain
// serializable shapes so the server → client boundary is clean.
// ────────────────────────────────────────────────────────────────────

type NodeStatus =
  | "not_started"
  | "running"
  | "idle"
  | "error"
  | "current"
  | "done";

interface DefNode {
  agentConfigId: string;
  canReceive: string[];
}
interface DefTransition {
  from: string;
  kind: "handoff" | "ask" | "reject" | "complete";
  to?: string;
}

export interface RunGraphProps {
  nodes: Record<string, DefNode>;
  transitions: DefTransition[];
  sessions: Array<{
    id: string;
    workflowNodeSlug: string | null;
    agentConfigId: string;
    status: string;
    totalCostUsd: string | null;
    createdAt: string | Date;
  }>;
  messages: Array<{
    fromNode: string | null;
    toNode: string;
    kind: "trigger" | "handoff" | "ask" | "answer" | "reject" | "complete";
    createdAt: string | Date;
  }>;
  agentNames: Record<string, string>;
  runStatus: "running" | "awaiting" | "done" | "error" | string;
  currentNode: string;
  /** When true, the page polls itself every 3s by calling router.refresh().
   *  Toggled off when the run is terminal. */
  livePoll: boolean;
}

// ────────────────────────────────────────────────────────────────────
// Derive per-node status from the spawned sessions. Picks the most recent
// session per node (the workflow can revisit the same node multiple times
// e.g. eng on a reject loop, but the latest session is the active one).
// ────────────────────────────────────────────────────────────────────

function nodeStatusMap(
  sessions: RunGraphProps["sessions"],
  currentNode: string,
  runStatus: string,
): Record<string, NodeStatus> {
  const latest = new Map<string, RunGraphProps["sessions"][number]>();
  for (const s of sessions) {
    if (!s.workflowNodeSlug) continue;
    const existing = latest.get(s.workflowNodeSlug);
    if (
      !existing ||
      new Date(s.createdAt).getTime() > new Date(existing.createdAt).getTime()
    ) {
      latest.set(s.workflowNodeSlug, s);
    }
  }
  const out: Record<string, NodeStatus> = {};
  for (const [slug, s] of latest.entries()) {
    if (s.status === "running") out[slug] = "running";
    else if (s.status === "error") out[slug] = "error";
    else if (s.status === "idle") out[slug] = "idle";
    else out[slug] = "idle";
  }
  // Override with the run-level "current" hint (only meaningful while running).
  if (runStatus === "running" && out[currentNode]) {
    if (out[currentNode] === "idle") out[currentNode] = "current";
  }
  return out;
}

// Edge counts: for each (from, kind, to) collect how many matching messages
// fired and the timestamp of the latest one. Drives the edge label + the
// "recent" highlight.
function edgeStats(
  transitions: DefTransition[],
  messages: RunGraphProps["messages"],
): Map<string, { count: number; lastAt: number | null }> {
  const stats = new Map<string, { count: number; lastAt: number | null }>();
  for (const t of transitions) {
    stats.set(transitionKey(t.from, t.kind, t.to), { count: 0, lastAt: null });
  }
  for (const m of messages) {
    if (m.kind === "trigger" || m.kind === "answer") continue; // not edges in the DAG
    if (!m.fromNode) continue;
    const k = transitionKey(
      m.fromNode,
      m.kind,
      m.kind === "complete" ? undefined : m.toNode,
    );
    const cur = stats.get(k);
    if (!cur) continue;
    const ts = new Date(m.createdAt).getTime();
    cur.count += 1;
    cur.lastAt = cur.lastAt === null ? ts : Math.max(cur.lastAt, ts);
  }
  return stats;
}

function transitionKey(from: string, kind: string, to: string | undefined) {
  return `${from}::${kind}::${to ?? "(end)"}`;
}

// ────────────────────────────────────────────────────────────────────
// Color tokens — chosen to read against both light and dark surfaces and
// to match the rest of the app's status palette in run-detail page.
// ────────────────────────────────────────────────────────────────────

const NODE_TONE: Record<NodeStatus, { ring: string; bg: string; tag: string; tagBg: string }> = {
  not_started: {
    ring: "rgba(120,120,140,0.3)",
    bg: "rgba(120,120,140,0.04)",
    tag: "rgb(140,140,160)",
    tagBg: "rgba(120,120,140,0.12)",
  },
  idle: {
    ring: "rgba(120,120,140,0.5)",
    bg: "rgba(120,120,140,0.06)",
    tag: "rgb(140,140,160)",
    tagBg: "rgba(120,120,140,0.15)",
  },
  current: {
    ring: "rgba(99,102,241,0.7)",
    bg: "rgba(99,102,241,0.08)",
    tag: "rgb(99,102,241)",
    tagBg: "rgba(99,102,241,0.15)",
  },
  running: {
    ring: "rgba(59,130,246,0.85)",
    bg: "rgba(59,130,246,0.1)",
    tag: "rgb(59,130,246)",
    tagBg: "rgba(59,130,246,0.18)",
  },
  done: {
    ring: "rgba(34,197,94,0.7)",
    bg: "rgba(34,197,94,0.08)",
    tag: "rgb(34,197,94)",
    tagBg: "rgba(34,197,94,0.15)",
  },
  error: {
    ring: "rgba(239,68,68,0.8)",
    bg: "rgba(239,68,68,0.1)",
    tag: "rgb(239,68,68)",
    tagBg: "rgba(239,68,68,0.18)",
  },
};

const EDGE_COLOR: Record<string, string> = {
  handoff: "rgb(99,102,241)", // indigo — forward motion
  ask: "rgb(168,85,247)", // purple — clarifying
  reject: "rgb(239,68,68)", // red — rework
  complete: "rgb(34,197,94)", // green — done
};

// ────────────────────────────────────────────────────────────────────
// Custom node component — a card showing slug, agent name, and status.
// ────────────────────────────────────────────────────────────────────

interface NodeData {
  label: string;
  agent: string;
  status: NodeStatus;
  cost: number | null;
  [key: string]: unknown;
}

function FlowNode({ data }: { data: NodeData }) {
  const tone = NODE_TONE[data.status];
  const statusLabel =
    data.status === "current"
      ? "current"
      : data.status === "not_started"
        ? "not started"
        : data.status;
  return (
    <div
      style={{
        background: tone.bg,
        border: `2px solid ${tone.ring}`,
        borderRadius: 14,
        padding: "10px 14px",
        minWidth: 180,
        boxShadow:
          data.status === "running"
            ? "0 0 0 4px rgba(59,130,246,0.15), 0 1px 4px rgba(0,0,0,0.2)"
            : "0 1px 4px rgba(0,0,0,0.15)",
        transition: "box-shadow 0.2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--fg, currentColor)",
          }}
        >
          {data.label}
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            fontWeight: 500,
            color: tone.tag,
            background: tone.tagBg,
            padding: "2px 7px",
            borderRadius: 999,
            textTransform: "uppercase",
            letterSpacing: 0.3,
          }}
        >
          {statusLabel}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 12,
          color: "var(--fg-muted, rgb(140,140,160))",
        }}
      >
        {data.agent}
      </div>
      {data.cost !== null && data.cost > 0 ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            color: "var(--fg-subtle, rgb(140,140,160))",
          }}
        >
          ${data.cost.toFixed(2)}
        </div>
      ) : null}
    </div>
  );
}

const nodeTypes: NodeTypes = { flow: FlowNode };

// ────────────────────────────────────────────────────────────────────
// Layout via dagre. Left-to-right with reasonable rank/node spacing.
// ────────────────────────────────────────────────────────────────────

const NODE_W = 200;
const NODE_H = 80;

function layoutNodes(
  rfNodes: Node[],
  rfEdges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 40 });
  for (const n of rfNodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of rfEdges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const positioned = rfNodes.map((n) => {
    const p = g.node(n.id);
    return {
      ...n,
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
    };
  });
  return { nodes: positioned, edges: rfEdges };
}

// ────────────────────────────────────────────────────────────────────

export function RunGraph(props: RunGraphProps) {
  const router = useRouter();

  // Live refresh — re-fetches the server component every 3s while the run
  // is still progressing. Stops once the run reaches a terminal state so
  // we don't poll forever.
  useEffect(() => {
    if (!props.livePoll) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [props.livePoll, router]);

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    const statusByNode = nodeStatusMap(
      props.sessions,
      props.currentNode,
      props.runStatus,
    );
    const costByNode = sumCostByNode(props.sessions);
    const stats = edgeStats(props.transitions, props.messages);

    const rfNodes: Node[] = Object.entries(props.nodes).map(([slug, n]) => {
      const status: NodeStatus = statusByNode[slug] ?? "not_started";
      const data: NodeData = {
        label: slug,
        agent: props.agentNames[n.agentConfigId] ?? "(missing agent)",
        status,
        cost: costByNode.get(slug) ?? null,
      };
      return {
        id: slug,
        type: "flow",
        data,
        position: { x: 0, y: 0 }, // overwritten by dagre
      };
    });

    // Synthetic "(end)" sink for `complete` transitions so they're visible.
    const completeTransitions = props.transitions.filter(
      (t) => t.kind === "complete",
    );
    if (completeTransitions.length > 0) {
      rfNodes.push({
        id: "(end)",
        type: "flow",
        data: {
          label: "✓ done",
          agent: "(workflow end)",
          status:
            props.runStatus === "done"
              ? ("done" as NodeStatus)
              : ("not_started" as NodeStatus),
          cost: null,
        } satisfies NodeData,
        position: { x: 0, y: 0 },
      });
    }

    const now = Date.now();
    const rfEdges: Edge[] = props.transitions.map((t, i) => {
      const target = t.to ?? "(end)";
      const stat = stats.get(transitionKey(t.from, t.kind, t.to)) ?? {
        count: 0,
        lastAt: null,
      };
      const recent = stat.lastAt !== null && now - stat.lastAt < 10_000;
      const color = EDGE_COLOR[t.kind] ?? "rgb(140,140,160)";
      const used = stat.count > 0;
      return {
        id: `e${i}`,
        source: t.from,
        target,
        type: "smoothstep",
        animated: recent || (used && t.kind === "handoff" && props.runStatus === "running"),
        label:
          stat.count > 0
            ? `${t.kind} ×${stat.count}`
            : t.kind,
        labelStyle: {
          fontSize: 11,
          fontFamily: "var(--font-sans, system-ui)",
          fill: used ? color : "rgb(140,140,160)",
          fontWeight: used ? 600 : 400,
        },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        labelBgStyle: {
          fill: "var(--surface-1, rgba(255,255,255,0.85))",
          fillOpacity: 0.9,
        },
        style: {
          stroke: used ? color : "rgba(140,140,160,0.4)",
          strokeWidth: used ? 2 : 1.5,
          strokeDasharray: used ? undefined : "4 3",
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: used ? color : "rgba(140,140,160,0.6)",
          width: 18,
          height: 18,
        },
      };
    });

    return layoutNodes(rfNodes, rfEdges);
  }, [
    props.nodes,
    props.transitions,
    props.sessions,
    props.messages,
    props.agentNames,
    props.runStatus,
    props.currentNode,
  ]);

  return (
    <div
      style={{
        height: 380,
        borderRadius: 16,
        overflow: "hidden",
        background:
          "linear-gradient(180deg, var(--surface-1, rgba(0,0,0,0.02)) 0%, transparent 100%)",
      }}
      className="ring-1 ring-hairline"
    >
      <ReactFlow
        nodes={layoutedNodes}
        edges={layoutedEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        zoomOnScroll
        panOnScroll
      >
        <Background gap={20} size={1} color="rgba(140,140,160,0.18)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function sumCostByNode(
  sessions: RunGraphProps["sessions"],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    if (!s.workflowNodeSlug) continue;
    const n = Number.parseFloat(s.totalCostUsd ?? "0");
    if (!Number.isFinite(n)) continue;
    out.set(s.workflowNodeSlug, (out.get(s.workflowNodeSlug) ?? 0) + n);
  }
  return out;
}
