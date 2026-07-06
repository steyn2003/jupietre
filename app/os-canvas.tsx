"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection as RFConnection,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import {
  KanbanIcon,
  ClockIcon,
  GitBranchIcon,
  RobotIcon,
  LinkSimpleIcon,
  GithubLogoIcon,
  PlugsConnectedIcon,
  UsersThreeIcon,
  BroadcastIcon,
  LightningIcon,
  XIcon,
} from "@phosphor-icons/react";
import "@xyflow/react/dist/style.css";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

// ────────────────────────────────────────────────────────────────────
// The Control canvas — a live flow chart of the whole workspace: triggers
// (left) → agents (middle) → resources (right), with running sessions
// lighting up the wiring. Polls /api/os/graph every 5s (skips when the
// tab is hidden). Same visual language as delegation-graph.tsx.
// ────────────────────────────────────────────────────────────────────

interface AgentDTO {
  id: string;
  slug: string;
  name: string;
  model: string;
  effort: string;
  enableLinearTools: number;
  enableGithubTools: number;
  enableAgentTools: number;
  enableEventTools: number;
  selectedSkillsCount: number | "all";
  maxBudgetUsd: number | null;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  runningCount: number;
  todayCostUsd: number;
  canEdit: boolean;
}
interface TriggerDTO {
  id: string;
  kind: "linear" | "schedule";
  label: string;
  subLabel: string;
  agentConfigId: string;
  href: string;
}
interface RepoDTO {
  id: string;
  slug: string;
  githubRepo: string;
}
interface DelegationEdgeDTO {
  fromAgentId: string;
  toAgentId: string;
  running: boolean;
}
interface RepoEdgeDTO {
  agentConfigId: string;
  repoId: string;
  running: boolean;
}
interface ConnectionDTO {
  id: string;
  slug: string;
  name: string;
  kind: "linear" | "github" | "mcp";
  canEdit: boolean;
}
interface GrantEdgeDTO {
  connectionId: string;
  agentConfigId: string;
}
interface EventTriggerDTO {
  id: string;
  kind: "subscription" | "webhook";
  label: string;
  subLabel: string;
  agentConfigId: string | null;
  topic: string;
  running: boolean;
}
interface EmitEdgeDTO {
  agentConfigId: string;
  topic: string;
}
interface RunningSessionDTO {
  agentConfigId: string;
  source: string;
}
interface RecentSessionDTO {
  id: string;
  title: string;
  status: string;
  agentConfigId: string;
  updatedAt: string;
}
interface GraphDTO {
  agents: AgentDTO[];
  triggers: TriggerDTO[];
  repos: RepoDTO[];
  connections: ConnectionDTO[];
  delegationEdges: DelegationEdgeDTO[];
  repoEdges: RepoEdgeDTO[];
  grantEdges: GrantEdgeDTO[];
  eventTriggers: EventTriggerDTO[];
  emitEdges: EmitEdgeDTO[];
  runningSessions: RunningSessionDTO[];
  recentSessions: RecentSessionDTO[];
}

const RUNNING = "rgb(59,130,246)";
const DIM = "rgba(140,140,160,0.45)";
const PURPLE = "rgba(168,85,247,0.7)";
const PURPLE_BG = "rgba(168,85,247,0.08)";
// Connections use a teal/amber tone, distinct from triggers (purple) + repos.
const TEAL = "rgba(20,184,166,0.75)";
const TEAL_BG = "rgba(20,184,166,0.08)";
// Event bus: subscriptions violet, webhooks slate — distinct from the purple
// Linear/schedule triggers so the two trigger families read apart.
const VIOLET = "rgba(124,58,237,0.8)";
const VIOLET_BG = "rgba(124,58,237,0.08)";
const SLATE = "rgba(100,116,139,0.75)";
const SLATE_BG = "rgba(100,116,139,0.08)";

/** Client mirror of lib/db/events.topicMatches — exact topic or a single
 *  trailing ".*" prefix wildcard. Kept local: the server module is server-only. */
function topicMatches(pattern: string, topic: string): boolean {
  if (pattern.endsWith(".*")) return topic.startsWith(pattern.slice(0, -1));
  return pattern === topic;
}

/** conn node id ↔ connection id. */
const connNodeId = (id: string) => `conn:${id}`;
const connIdFromNode = (nodeId: string) => nodeId.replace(/^conn:/, "");

// Near-invisible handle — present so ReactFlow can wire/connect edges, but it
// shouldn't clutter the card. Connection source handle gets a visible dot.
const HIDDEN_HANDLE: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: "none",
  background: "transparent",
};

function shortModel(model: string): string {
  return model.replace(/^claude-/, "");
}

// ────────────────────────────────────────────────────────────────────
// Custom node cards — rounded 14, 2px tone ring, status pills. Matches
// TreeCard from delegation-graph.tsx.
// ────────────────────────────────────────────────────────────────────

const CARD_BASE: React.CSSProperties = {
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
};

function Chip({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 10,
        fontWeight: 500,
        color: tone,
        background: "rgba(140,140,160,0.12)",
        padding: "2px 6px",
        borderRadius: 999,
      }}
    >
      <span style={{ display: "inline-flex", width: 11, height: 11 }}>{icon}</span>
      {label}
    </span>
  );
}

interface TriggerData extends Record<string, unknown> {
  kind: "linear" | "schedule";
  label: string;
  subLabel: string;
}

function TriggerNode({ data }: { data: TriggerData }) {
  return (
    <div
      style={{
        ...CARD_BASE,
        width: 210,
        background: PURPLE_BG,
        border: `2px solid ${PURPLE}`,
      }}
    >
      {/* display-only source — triggers feed edges into agents. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectableStart={false}
        isConnectableEnd={false}
        style={HIDDEN_HANDLE}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            display: "inline-flex",
            width: 14,
            height: 14,
            color: "rgb(168,85,247)",
            flexShrink: 0,
          }}
        >
          {data.kind === "linear" ? (
            <KanbanIcon weight="fill" />
          ) : (
            <ClockIcon weight="fill" />
          )}
        </span>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--fg, currentColor)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.label}
        </div>
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
        {data.subLabel}
      </div>
    </div>
  );
}

interface AgentData extends Record<string, unknown> {
  name: string;
  model: string;
  enableLinearTools: boolean;
  enableGithubTools: boolean;
  enableAgentTools: boolean;
  enableEventTools: boolean;
  runningCount: number;
  todayCostUsd: number;
  focused: boolean;
}

function AgentNode({ data }: { data: AgentData }) {
  const running = data.runningCount > 0;
  const ring = running ? "rgba(59,130,246,0.85)" : "rgba(120,120,140,0.5)";
  const bg = running ? "rgba(59,130,246,0.1)" : "rgba(120,120,140,0.06)";
  return (
    <div
      style={{
        ...CARD_BASE,
        width: 230,
        background: bg,
        border: `2px solid ${ring}`,
        outline: data.focused ? "2px solid rgba(99,102,241,0.55)" : undefined,
        outlineOffset: 3,
        boxShadow: running
          ? "0 0 0 4px rgba(59,130,246,0.15), 0 1px 4px rgba(0,0,0,0.2)"
          : "0 1px 4px rgba(0,0,0,0.15)",
      }}
    >
      {/* target (left): accepts grant/trigger/delegation edges. Only an
          incoming endpoint — users can't start a connection from it. */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectableStart={false}
        style={HIDDEN_HANDLE}
      />
      {/* source (right): display-only endpoint for delegation/repo edges. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectableStart={false}
        isConnectableEnd={false}
        style={HIDDEN_HANDLE}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", width: 14, height: 14, color: "var(--fg-muted)", flexShrink: 0 }}>
          <RobotIcon weight="regular" />
        </span>
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
          {data.name}
        </div>
        {running ? (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              fontWeight: 600,
              color: RUNNING,
              background: "rgba(59,130,246,0.18)",
              padding: "2px 7px",
              borderRadius: 999,
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span className="os-pulse" style={{ width: 6, height: 6, borderRadius: 999, background: RUNNING }} />
            {data.runningCount} live
          </span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: "var(--fg-subtle, rgb(140,140,160))",
        }}
      >
        {data.model}
      </div>
      {data.enableLinearTools ||
      data.enableGithubTools ||
      data.enableAgentTools ||
      data.enableEventTools ? (
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
          {data.enableLinearTools ? (
            <Chip icon={<KanbanIcon weight="bold" />} label="Linear" tone="rgb(168,85,247)" />
          ) : null}
          {data.enableGithubTools ? (
            <Chip icon={<GithubLogoIcon weight="bold" />} label="GitHub" tone="var(--fg-muted)" />
          ) : null}
          {data.enableAgentTools ? (
            <Chip icon={<UsersThreeIcon weight="bold" />} label="Delegate" tone="rgb(99,102,241)" />
          ) : null}
          {data.enableEventTools ? (
            <Chip icon={<BroadcastIcon weight="bold" />} label="Events" tone="rgb(124,58,237)" />
          ) : null}
        </div>
      ) : null}
      {data.todayCostUsd > 0 ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            color: "var(--fg-subtle, rgb(140,140,160))",
          }}
        >
          ${data.todayCostUsd.toFixed(2)} today
        </div>
      ) : null}
    </div>
  );
}

interface ResourceData extends Record<string, unknown> {
  slug: string;
  githubRepo: string;
}

function ResourceNode({ data }: { data: ResourceData }) {
  return (
    <div
      style={{
        ...CARD_BASE,
        width: 200,
        background: "rgba(120,120,140,0.05)",
        border: "2px solid rgba(120,120,140,0.4)",
      }}
    >
      {/* display-only target — repos receive edges from agents, never grants. */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectableStart={false}
        isConnectableEnd={false}
        style={HIDDEN_HANDLE}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ display: "inline-flex", width: 13, height: 13, color: "var(--fg-muted)", flexShrink: 0 }}>
          <GitBranchIcon weight="regular" />
        </span>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--fg, currentColor)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.slug}
        </div>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          fontFamily: "monospace",
          color: "var(--fg-subtle, rgb(140,140,160))",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {data.githubRepo}
      </div>
    </div>
  );
}

interface ConnectionNodeData extends Record<string, unknown> {
  kind: "linear" | "github" | "mcp";
  name: string;
  slug: string;
}

function ConnectionNode({ data }: { data: ConnectionNodeData }) {
  const glyph =
    data.kind === "linear" ? (
      <KanbanIcon weight="fill" />
    ) : data.kind === "github" ? (
      <GithubLogoIcon weight="fill" />
    ) : (
      <PlugsConnectedIcon weight="fill" />
    );
  return (
    <div
      style={{
        ...CARD_BASE,
        width: 200,
        background: TEAL_BG,
        border: `2px solid ${TEAL}`,
      }}
    >
      {/* source (right): the only place a user can start a grant edge. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectableEnd={false}
        style={{
          width: 9,
          height: 9,
          background: "rgb(20,184,166)",
          border: "2px solid var(--surface-1, #fff)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            display: "inline-flex",
            width: 13,
            height: 13,
            color: "rgb(20,184,166)",
            flexShrink: 0,
          }}
        >
          {glyph}
        </span>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--fg, currentColor)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.name}
        </div>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          fontFamily: "monospace",
          color: "var(--fg-subtle, rgb(140,140,160))",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {data.kind} · {data.slug}
      </div>
    </div>
  );
}

interface EventNodeData extends Record<string, unknown> {
  kind: "subscription" | "webhook";
  label: string;
  subLabel: string;
}

function EventNode({ data }: { data: EventNodeData }) {
  const isSub = data.kind === "subscription";
  const tone = isSub ? "rgb(124,58,237)" : "rgb(100,116,139)";
  return (
    <div
      style={{
        ...CARD_BASE,
        width: 210,
        background: isSub ? VIOLET_BG : SLATE_BG,
        border: `2px solid ${isSub ? VIOLET : SLATE}`,
      }}
    >
      {/* target (left): subscriptions receive webhook + emit edges. */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectableStart={false}
        isConnectableEnd={false}
        style={HIDDEN_HANDLE}
      />
      {/* source (right): subscription → agent, webhook → subscription. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectableStart={false}
        isConnectableEnd={false}
        style={HIDDEN_HANDLE}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            display: "inline-flex",
            width: 14,
            height: 14,
            color: tone,
            flexShrink: 0,
          }}
        >
          {isSub ? (
            <BroadcastIcon weight="fill" />
          ) : (
            <LightningIcon weight="fill" />
          )}
        </span>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--fg, currentColor)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.label}
        </div>
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
        {data.subLabel}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  resource: ResourceNode,
  connection: ConnectionNode,
  subscription: EventNode,
  webhook: EventNode,
};

const NODE_W = 230;
const NODE_H = 92;

function edgeStyle(running: boolean, color = DIM): Edge {
  const stroke = running ? RUNNING : color;
  return {
    id: "",
    source: "",
    target: "",
    type: "smoothstep",
    animated: running,
    // Structural edges are display-only — not selectable/deletable. Only
    // grant edges opt into interaction (see buildGraph).
    selectable: false,
    deletable: false,
    style: { stroke, strokeWidth: running ? 2 : 1.5 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: stroke,
      width: 16,
      height: 16,
    },
  };
}

function buildGraph(data: GraphDTO): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Running-by-source lookup for trigger-edge animation.
  const runningSources = new Set(
    data.runningSessions.map((s) => `${s.agentConfigId}:${s.source}`),
  );
  const agentIds = new Set(data.agents.map((a) => a.id));

  for (const t of data.triggers) {
    nodes.push({
      id: t.id,
      type: "trigger",
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { kind: t.kind, label: t.label, subLabel: t.subLabel } satisfies TriggerData,
      position: { x: 0, y: 0 },
    });
    if (agentIds.has(t.agentConfigId)) {
      const running = runningSources.has(`${t.agentConfigId}:${t.kind}`);
      edges.push({
        ...edgeStyle(running, PURPLE),
        id: `te-${t.id}`,
        source: t.id,
        target: t.agentConfigId,
      });
    }
  }

  for (const a of data.agents) {
    nodes.push({
      id: a.id,
      type: "agent",
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        name: a.name,
        model: shortModel(a.model),
        enableLinearTools: a.enableLinearTools === 1,
        enableGithubTools: a.enableGithubTools === 1,
        enableAgentTools: a.enableAgentTools === 1,
        enableEventTools: a.enableEventTools === 1,
        runningCount: a.runningCount,
        todayCostUsd: a.todayCostUsd,
        focused: false,
      } satisfies AgentData,
      position: { x: 0, y: 0 },
    });
  }

  for (const r of data.repos) {
    nodes.push({
      id: `repo:${r.id}`,
      type: "resource",
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { slug: r.slug, githubRepo: r.githubRepo } satisfies ResourceData,
      position: { x: 0, y: 0 },
    });
  }

  // Connections sit on the left (like triggers) and feed grant edges into
  // agents. dagre ranks them ahead of agents via those edges.
  for (const c of data.connections) {
    nodes.push({
      id: connNodeId(c.id),
      type: "connection",
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        kind: c.kind,
        name: c.name,
        slug: c.slug,
      } satisfies ConnectionNodeData,
      position: { x: 0, y: 0 },
    });
  }

  for (const d of data.delegationEdges) {
    edges.push({
      ...edgeStyle(d.running, "rgba(99,102,241,0.5)"),
      id: `de-${d.fromAgentId}-${d.toAgentId}`,
      source: d.fromAgentId,
      target: d.toAgentId,
    });
  }

  for (const e of data.repoEdges) {
    edges.push({
      ...edgeStyle(e.running),
      id: `re-${e.agentConfigId}-${e.repoId}`,
      source: e.agentConfigId,
      target: `repo:${e.repoId}`,
    });
  }

  // Grant edges — connection → agent. Dashed teal, visually distinct from
  // structural edges, and the only interactive (selectable/deletable) edges.
  for (const g of data.grantEdges) {
    if (!agentIds.has(g.agentConfigId)) continue;
    edges.push({
      id: grantEdgeId(g.connectionId, g.agentConfigId),
      source: connNodeId(g.connectionId),
      target: g.agentConfigId,
      type: "smoothstep",
      selectable: true,
      deletable: true,
      focusable: true,
      data: {
        connectionId: g.connectionId,
        agentConfigId: g.agentConfigId,
      },
      style: {
        stroke: TEAL,
        strokeWidth: 1.5,
        strokeDasharray: "5 4",
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: TEAL,
        width: 15,
        height: 15,
      },
    });
  }

  // Event bus — subscription (violet) + webhook (slate) nodes. Non-interactive
  // structural edges like triggers, never deletable.
  const subs = data.eventTriggers.filter((t) => t.kind === "subscription");
  const hooks = data.eventTriggers.filter((t) => t.kind === "webhook");
  for (const t of data.eventTriggers) {
    nodes.push({
      id: t.id,
      type: t.kind,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        kind: t.kind,
        label: t.label,
        subLabel: t.subLabel,
      } satisfies EventNodeData,
      position: { x: 0, y: 0 },
    });
  }
  // subscription → agent (animated when a triggered session is running).
  for (const s of subs) {
    if (!s.agentConfigId || !agentIds.has(s.agentConfigId)) continue;
    edges.push({
      ...edgeStyle(s.running, VIOLET),
      id: `sube-${s.id}`,
      source: s.id,
      target: s.agentConfigId,
    });
  }
  // webhook → each subscription whose pattern matches its topic (dim slate).
  for (const h of hooks) {
    for (const s of subs) {
      if (!topicMatches(s.topic, h.topic)) continue;
      edges.push({
        ...edgeStyle(false, SLATE),
        id: `he-${h.id}-${s.id}`,
        source: h.id,
        target: s.id,
      });
    }
  }
  // emit edges — agent → matching subscription(s), dim dashed. Skipped when
  // no subscription matches (no dangling topic nodes).
  for (const e of data.emitEdges) {
    if (!agentIds.has(e.agentConfigId)) continue;
    for (const s of subs) {
      if (!topicMatches(s.topic, e.topic)) continue;
      edges.push({
        id: `emit-${e.agentConfigId}-${s.id}-${e.topic}`,
        source: e.agentConfigId,
        target: s.id,
        type: "smoothstep",
        selectable: false,
        deletable: false,
        style: { stroke: VIOLET, strokeWidth: 1.5, strokeDasharray: "5 4" },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: VIOLET,
          width: 15,
          height: 15,
        },
      });
    }
  }

  return { nodes, edges };
}

const grantEdgeId = (connectionId: string, agentConfigId: string) =>
  `ge-${connectionId}-${agentConfigId}`;

function layout(nodes: Node[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 120, nodesep: 28 });
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p) out.set(n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  }
  return out;
}

export function OsCanvas() {
  const router = useRouter();
  const [data, setData] = useState<GraphDTO | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edgeError, setEdgeError] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Positions keyed by node id — preserves user-dragged layout across polls;
  // dagre only re-runs when the set of node ids changes.
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const layoutSigRef = useRef<string>("");

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

  // Reconcile fetched data into the flow, preserving positions.
  useEffect(() => {
    if (!data) return;
    const { nodes: rawNodes, edges: rawEdges } = buildGraph(data);
    const sig = rawNodes.map((n) => n.id).sort().join("|");

    if (sig !== layoutSigRef.current) {
      const laid = layout(rawNodes, rawEdges);
      const merged = new Map(laid);
      // keep any dragged positions for nodes that still exist
      for (const [id, pos] of positionsRef.current) {
        if (laid.has(id)) merged.set(id, pos);
      }
      positionsRef.current = merged;
      layoutSigRef.current = sig;
    }

    setNodes(
      rawNodes.map((n) => ({
        ...n,
        position: positionsRef.current.get(n.id) ?? n.position,
        data: n.type === "agent" ? { ...n.data, focused: n.id === selectedId } : n.data,
      })),
    );
    setEdges(rawEdges);
  }, [data, selectedId, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "agent") {
        setSelectedId(node.id);
        return;
      }
      if (node.type === "resource") {
        router.push("/repos");
        return;
      }
      if (node.type === "connection") {
        router.push("/connections");
        return;
      }
      if (node.type === "subscription" || node.type === "webhook") {
        router.push("/events");
        return;
      }
      if (node.type === "trigger") {
        const t = data?.triggers.find((x) => x.id === node.id);
        if (t) router.push(t.href);
      }
    },
    [data, router],
  );

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    positionsRef.current.set(node.id, node.position);
  }, []);

  const agentIdSet = useMemo(
    () => new Set((data?.agents ?? []).map((a) => a.id)),
    [data],
  );

  // Only allow connection(source) → agent(target). Guards the drag UI on top
  // of the per-handle isConnectable* flags.
  const isValidConnection = useCallback(
    (c: RFConnection | Edge) =>
      typeof c.source === "string" &&
      typeof c.target === "string" &&
      c.source.startsWith("conn:") &&
      agentIdSet.has(c.target),
    [agentIdSet],
  );

  // Drag connection → agent = create a grant. Optimistic add; rollback + toast
  // on failure (e.g. no edit rights on the agent).
  const onConnect = useCallback(
    (conn: RFConnection) => {
      if (!conn.source || !conn.target || !isValidConnection(conn)) return;
      const connectionId = connIdFromNode(conn.source);
      const agentConfigId = conn.target;
      const id = grantEdgeId(connectionId, agentConfigId);
      if (edges.some((e) => e.id === id)) return; // already granted

      setEdgeError(null);
      setEdges((eds) =>
        addEdge(
          {
            id,
            source: conn.source!,
            target: conn.target!,
            type: "smoothstep",
            selectable: true,
            deletable: true,
            focusable: true,
            data: { connectionId, agentConfigId },
            style: { stroke: TEAL, strokeWidth: 1.5, strokeDasharray: "5 4" },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: TEAL,
              width: 15,
              height: 15,
            },
          },
          eds,
        ),
      );

      void (async () => {
        try {
          const res = await fetch(`/api/agents/${agentConfigId}/grants`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connectionId }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              error?: string;
            } | null;
            setEdges((eds) => eds.filter((e) => e.id !== id));
            setEdgeError(body?.error ?? "Could not create grant.");
            return;
          }
          void load();
        } catch {
          setEdges((eds) => eds.filter((e) => e.id !== id));
          setEdgeError("Could not create grant.");
        }
      })();
    },
    [edges, isValidConnection, setEdges, load],
  );

  // Select a grant edge + press Delete/Backspace → remove the grant. Only
  // grant edges are deletable, so this never touches structural wiring.
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) {
        const d = e.data as
          | { connectionId?: string; agentConfigId?: string }
          | undefined;
        if (!d?.connectionId || !d?.agentConfigId) continue;
        const { connectionId, agentConfigId } = d;
        setEdgeError(null);
        void (async () => {
          try {
            const res = await fetch(`/api/agents/${agentConfigId}/grants`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ connectionId }),
            });
            if (!res.ok) {
              const body = (await res.json().catch(() => null)) as {
                error?: string;
              } | null;
              setEdgeError(body?.error ?? "Could not remove grant.");
            }
            void load();
          } catch {
            setEdgeError("Could not remove grant.");
            void load();
          }
        })();
      }
    },
    [load],
  );

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
      <style>{`@keyframes os-pulse{0%,100%{opacity:1}50%{opacity:0.35}}.os-pulse{animation:os-pulse 1.4s ease-in-out infinite}`}</style>
      <div
        style={{
          height: "clamp(480px, 72vh, 900px)",
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
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable
          nodesConnectable
          zoomOnScroll
          panOnScroll
        >
          <Background gap={20} size={1} color="rgba(140,140,160,0.18)" />
          <Controls showInteractive={false} />
        </ReactFlow>

        <AnimatePresence>
          {edgeError ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-danger-soft px-4 py-2 text-[12px] text-danger ring-1 ring-[color:var(--danger-soft)] shadow-lg"
              onClick={() => setEdgeError(null)}
            >
              {edgeError}
            </motion.div>
          ) : null}
        </AnimatePresence>
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

// ────────────────────────────────────────────────────────────────────
// Right-side inspector — read-only summary + functional enable toggles.
// ────────────────────────────────────────────────────────────────────

const statusTone: Record<string, string> = {
  running: RUNNING,
  error: "rgb(239,68,68)",
  idle: "var(--fg-subtle)",
};

function AgentInspector({
  agent,
  sessions,
  connections,
  grantedConnectionIds,
  onClose,
  onPatched,
}: {
  agent: AgentDTO;
  sessions: RecentSessionDTO[];
  connections: ConnectionDTO[];
  grantedConnectionIds: string[];
  onClose: () => void;
  onPatched: () => void;
}) {
  const [flags, setFlags] = useState({
    enableLinearTools: agent.enableLinearTools === 1,
    enableGithubTools: agent.enableGithubTools === 1,
    enableAgentTools: agent.enableAgentTools === 1,
    enableEventTools: agent.enableEventTools === 1,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [grantBusy, setGrantBusy] = useState<string | null>(null);
  const [addConnId, setAddConnId] = useState("");

  const grantedSet = new Set(grantedConnectionIds);
  const grantedConnections = connections.filter((c) => grantedSet.has(c.id));
  const availableConnections = connections.filter((c) => !grantedSet.has(c.id));

  async function grant(connectionId: string) {
    if (!agent.canEdit) {
      setError("You can only edit agents you own.");
      return;
    }
    setError(null);
    setGrantBusy(connectionId);
    try {
      const res = await fetch(`/api/agents/${agent.id}/grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not add connection.");
      } else {
        setAddConnId("");
        onPatched();
      }
    } catch {
      setError("Could not add connection.");
    } finally {
      setGrantBusy(null);
    }
  }

  async function revoke(connectionId: string) {
    if (!agent.canEdit) {
      setError("You can only edit agents you own.");
      return;
    }
    setError(null);
    setGrantBusy(connectionId);
    try {
      const res = await fetch(`/api/agents/${agent.id}/grants`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not remove connection.");
      } else {
        onPatched();
      }
    } catch {
      setError("Could not remove connection.");
    } finally {
      setGrantBusy(null);
    }
  }

  async function toggle(key: keyof typeof flags) {
    if (!agent.canEdit) {
      setError("You can only edit agents you own.");
      return;
    }
    const next = !flags[key];
    setFlags((f) => ({ ...f, [key]: next }));
    setError(null);
    setSaving(key);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setFlags((f) => ({ ...f, [key]: !next }));
        setError(body?.error ?? "Update failed.");
      } else {
        onPatched();
      }
    } catch {
      setFlags((f) => ({ ...f, [key]: !next }));
      setError("Update failed.");
    } finally {
      setSaving(null);
    }
  }

  const budgets = [
    agent.maxBudgetUsd != null ? `$${agent.maxBudgetUsd}/session` : null,
    agent.dailyBudgetUsd != null ? `$${agent.dailyBudgetUsd}/day` : null,
    agent.monthlyBudgetUsd != null ? `$${agent.monthlyBudgetUsd}/mo` : null,
  ].filter(Boolean) as string[];

  const capChips = [
    agent.enableLinearTools === 1 ? "Linear" : null,
    agent.enableGithubTools === 1 ? "GitHub" : null,
    agent.enableAgentTools === 1 ? "Delegate" : null,
    agent.enableEventTools === 1 ? "Events" : null,
  ].filter(Boolean) as string[];

  return (
    <motion.aside
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 32, opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      className="absolute right-3 top-3 bottom-3 z-10 w-[320px] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl bg-surface-1/95 backdrop-blur-xl ring-1 ring-hairline shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">Agent</p>
          <h3 className="mt-0.5 truncate text-[16px] font-medium text-fg">{agent.name}</h3>
          <p className="mt-0.5 font-mono text-[12px] text-fg-subtle">
            {shortModel(agent.model)} · {agent.effort}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg hover:bg-surface-2"
        >
          <XIcon weight="bold" className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 px-4 pb-4">
        {capChips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {capChips.map((c) => (
              <span
                key={c}
                className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted ring-1 ring-hairline"
              >
                {c}
              </span>
            ))}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">Capabilities</p>
          <ToggleRow
            icon={<KanbanIcon weight="regular" className="h-4 w-4" />}
            label="Linear tools"
            on={flags.enableLinearTools}
            busy={saving === "enableLinearTools"}
            onToggle={() => void toggle("enableLinearTools")}
          />
          <ToggleRow
            icon={<GithubLogoIcon weight="regular" className="h-4 w-4" />}
            label="GitHub tools"
            on={flags.enableGithubTools}
            busy={saving === "enableGithubTools"}
            onToggle={() => void toggle("enableGithubTools")}
          />
          <ToggleRow
            icon={<UsersThreeIcon weight="regular" className="h-4 w-4" />}
            label="Delegate (orchestrator)"
            on={flags.enableAgentTools}
            busy={saving === "enableAgentTools"}
            onToggle={() => void toggle("enableAgentTools")}
          />
          <ToggleRow
            icon={<BroadcastIcon weight="regular" className="h-4 w-4" />}
            label="Event tools"
            on={flags.enableEventTools}
            busy={saving === "enableEventTools"}
            onToggle={() => void toggle("enableEventTools")}
          />
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">
            Connections
          </p>
          {grantedConnections.length === 0 ? (
            <p className="text-[12px] text-fg-subtle">
              No connections granted.
            </p>
          ) : (
            <ul className="space-y-1">
              {grantedConnections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg bg-surface-2/60 px-2.5 py-1.5"
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: "rgb(20,184,166)" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg">
                    {c.name}
                    <span className="ml-1 text-fg-subtle">· {c.kind}</span>
                  </span>
                  {agent.canEdit ? (
                    <button
                      aria-label={`Remove ${c.name}`}
                      disabled={grantBusy === c.id}
                      onClick={() => void revoke(c.id)}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-danger hover:bg-surface-1 disabled:opacity-50"
                    >
                      <XIcon weight="bold" className="h-3 w-3" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {agent.canEdit && availableConnections.length > 0 ? (
            <div className="flex items-center gap-2 pt-1">
              <select
                value={addConnId}
                onChange={(e) => setAddConnId(e.target.value)}
                className="h-8 flex-1 rounded-lg bg-surface-2 px-2 text-[12px] text-fg ring-1 ring-hairline"
              >
                <option value="">Add a connection…</option>
                {availableConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.kind})
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!addConnId || grantBusy === addConnId}
                onClick={() => addConnId && void grant(addConnId)}
              >
                Add
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-muted">
          <span>
            Skills:{" "}
            <span className="text-fg">
              {agent.selectedSkillsCount === "all" ? "all" : agent.selectedSkillsCount}
            </span>
          </span>
          {budgets.length > 0 ? (
            <span>
              Budget: <span className="text-fg">{budgets.join(" · ")}</span>
            </span>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">Recent sessions</p>
          {sessions.length === 0 ? (
            <p className="text-[12px] text-fg-subtle">No recent sessions.</p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/sessions/${s.id}`}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: statusTone[s.status] ?? "var(--fg-subtle)" }}
                    />
                    <span className="truncate text-[12px] text-fg">{s.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Link href={`/agents/${agent.id}/edit`} className="flex-1">
            <Button variant="secondary" size="sm" fullWidth leadingIcon={<LinkSimpleIcon weight="bold" className="h-3.5 w-3.5" />}>
              Open agent
            </Button>
          </Link>
          <Link href={`/sessions/new?agent=${agent.slug}`} className="flex-1">
            <Button size="sm" fullWidth>
              New session
            </Button>
          </Link>
        </div>
      </div>
    </motion.aside>
  );
}

function ToggleRow({
  icon,
  label,
  on,
  busy,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="inline-flex h-4 w-4 items-center justify-center text-fg-muted">{icon}</span>
      <span className="flex-1 text-[13px] text-fg">{label}</span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={busy}
        onClick={onToggle}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
        style={{ background: on ? "var(--accent)" : "var(--surface-2)" }}
      >
        <span
          className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: on ? "translateX(18px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}
