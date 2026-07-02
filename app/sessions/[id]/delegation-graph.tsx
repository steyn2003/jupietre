"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
// Live delegation tree — orchestrator + the sub-agents it spawned via
// agent_spawn, one card per session, updated by polling /tree. Renders
// nothing for plain sessions (tree of one), so it costs regular chats
// no screen space. Click a card to jump to that session.
// Same visual language as the workflow run graph (run-graph.tsx).
// ────────────────────────────────────────────────────────────────────

interface TreeNode {
  id: string;
  parentId: string | null;
  title: string;
  agentName: string;
  status: string;
  costUsd: number;
  createdAt: string;
}

const TONE: Record<string, { ring: string; bg: string; tag: string; tagBg: string }> = {
  idle: {
    ring: "rgba(34,197,94,0.6)",
    bg: "rgba(34,197,94,0.06)",
    tag: "rgb(34,197,94)",
    tagBg: "rgba(34,197,94,0.15)",
  },
  running: {
    ring: "rgba(59,130,246,0.85)",
    bg: "rgba(59,130,246,0.1)",
    tag: "rgb(59,130,246)",
    tagBg: "rgba(59,130,246,0.18)",
  },
  error: {
    ring: "rgba(239,68,68,0.8)",
    bg: "rgba(239,68,68,0.1)",
    tag: "rgb(239,68,68)",
    tagBg: "rgba(239,68,68,0.18)",
  },
};

interface CardData {
  agentName: string;
  title: string;
  status: string;
  cost: number;
  focused: boolean;
  [key: string]: unknown;
}

function TreeCard({ data }: { data: CardData }) {
  const tone = TONE[data.status] ?? TONE.idle;
  return (
    <div
      style={{
        background: tone.bg,
        border: `2px solid ${tone.ring}`,
        outline: data.focused ? "2px solid rgba(99,102,241,0.55)" : undefined,
        outlineOffset: 3,
        borderRadius: 14,
        padding: "10px 14px",
        width: 220,
        cursor: "pointer",
        boxShadow:
          data.status === "running"
            ? "0 0 0 4px rgba(59,130,246,0.15), 0 1px 4px rgba(0,0,0,0.2)"
            : "0 1px 4px rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--fg, currentColor)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.agentName}
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
            flexShrink: 0,
          }}
        >
          {data.status}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          color: "var(--fg-muted, rgb(140,140,160))",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {data.title}
      </div>
      {data.cost > 0 ? (
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

const nodeTypes: NodeTypes = { card: TreeCard };

const NODE_W = 220;
const NODE_H = 78;

export function DelegationGraph({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [tree, setTree] = useState<{
    focusedId: string;
    nodes: TreeNode[];
  } | null>(null);

  const load = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/tree`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        focusedId: string;
        nodes: TreeNode[];
      };
      setTree(data);
    } catch {
      // transient fetch failure — next poll retries
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [load]);

  const { nodes, edges } = useMemo(() => {
    if (!tree || tree.nodes.length < 2)
      return { nodes: [] as Node[], edges: [] as Edge[] };

    const rfNodes: Node[] = tree.nodes.map((n) => ({
      id: n.id,
      type: "card",
      data: {
        agentName: n.agentName,
        title: n.title,
        status: n.status,
        cost: n.costUsd,
        focused: n.id === tree.focusedId,
      } satisfies CardData,
      position: { x: 0, y: 0 },
    }));
    const rfEdges: Edge[] = tree.nodes
      .filter((n) => n.parentId)
      .map((n) => ({
        id: `e-${n.id}`,
        source: n.parentId!,
        target: n.id,
        type: "smoothstep",
        animated: n.status === "running",
        style: {
          stroke:
            n.status === "running"
              ? "rgb(59,130,246)"
              : "rgba(140,140,160,0.5)",
          strokeWidth: n.status === "running" ? 2 : 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color:
            n.status === "running"
              ? "rgb(59,130,246)"
              : "rgba(140,140,160,0.6)",
          width: 18,
          height: 18,
        },
      }));

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "TB", ranksep: 60, nodesep: 30 });
    for (const n of rfNodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
    for (const e of rfEdges) g.setEdge(e.source, e.target);
    dagre.layout(g);
    return {
      nodes: rfNodes.map((n) => {
        const p = g.node(n.id);
        return { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } };
      }),
      edges: rfEdges,
    };
  }, [tree]);

  if (nodes.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        Delegation tree
      </p>
      <div
        style={{
          height: Math.min(420, 120 + nodes.length * 40),
          borderRadius: 16,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, var(--surface-1, rgba(0,0,0,0.02)) 0%, transparent 100%)",
        }}
        className="ring-1 ring-hairline"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => {
            if (node.id !== sessionId) router.push(`/sessions/${node.id}`);
          }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnScroll
        >
          <Background gap={20} size={1} color="rgba(140,140,160,0.18)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
