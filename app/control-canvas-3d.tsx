"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import * as THREE from "three";
import { shortModel, topicMatches, type GraphDTO } from "./os-graph-types";

/**
 * ControlCanvas3D — the Control canvas rendered as a Three.js scene in the
 * visual language of AgentConstellation: glowing additive orbs, faint
 * hairline wiring, sparks of light travelling along running edges.
 *
 * Composition: a deterministic 3-plane depth layout —
 *   back/left  → webhooks (furthest) + triggers/subscriptions,
 *   center     → agents (largest orbs),
 *   front/right→ connections + repos.
 * Positions are derived purely from the graph data (sorted + id-hash
 * jitter), so a 5s poll never reshuffles the world.
 *
 * Budget (hard): 3 draw calls — one THREE.Points for all nodes, one
 * THREE.LineSegments for all edges (per-vertex colors), one THREE.Points
 * for travelling pulses. No lights, no shadows, no postprocessing.
 * Labels are DOM chips projected to screen space each frame (crisp text,
 * real focus targets). DPR capped at 2; RAF pauses on document.hidden;
 * prefers-reduced-motion gets a static frame with render-on-demand for
 * user-driven orbit/zoom; everything is disposed on unmount.
 */

export type SceneNodeKind =
  | "trigger"
  | "agent"
  | "repo"
  | "connection"
  | "subscription"
  | "webhook";

export interface ScenePick {
  kind: SceneNodeKind;
  /** Raw DTO id (repo:/conn: prefixes stripped). */
  id: string;
}

export interface ControlCanvas3DHandle {
  resetView(): void;
}

interface ControlCanvas3DProps {
  data: GraphDTO;
  selectedId: string | null;
  onPick: (pick: ScenePick) => void;
  onBackgroundClick?: () => void;
  className?: string;
  ref?: Ref<ControlCanvas3DHandle>;
}

// ── Visual language ──────────────────────────────────────────────────

const LIVE = "#3b82f6";
const AGENT_RUNNING = "#79a3ff";

const KIND_VISUAL: Record<
  SceneNodeKind,
  { color: string; dim: number; size: number }
> = {
  agent: { color: "#5b8def", dim: 1.0, size: 2.5 },
  trigger: { color: "#a855f7", dim: 0.72, size: 1.5 },
  subscription: { color: "#8b5cf6", dim: 0.78, size: 1.5 },
  webhook: { color: "#64748b", dim: 0.8, size: 1.25 },
  connection: { color: "#2dd4bf", dim: 0.78, size: 1.6 },
  repo: { color: "#c9a173", dim: 0.85, size: 1.7 },
};

type EdgeFamily =
  | "trigger"
  | "event"
  | "wire"
  | "emit"
  | "delegation"
  | "repo"
  | "grant";

const EDGE_TONE: Record<EdgeFamily, string> = {
  trigger: "#a855f7",
  event: "#8b5cf6",
  wire: "#64748b",
  emit: "#8b5cf6",
  delegation: "#6366f1",
  repo: "#9d9daa",
  grant: "#14b8a6",
};

/** Static (non-running) edge brightness per family — pre-multiplied into
 *  vertex colors so the whole wiring stays one additive draw call. */
const EDGE_STATIC: Record<EdgeFamily, number> = {
  trigger: 0.34,
  event: 0.36,
  wire: 0.2,
  emit: 0.26,
  delegation: 0.32,
  repo: 0.28,
  grant: 0.34,
};

const EDGE_RUN_COLOR = new THREE.Color(LIVE).multiplyScalar(0.95);
const PULSE_COLOR = new THREE.Color(AGENT_RUNNING);

// ── Deterministic layout: three depth planes ─────────────────────────

type ColumnId = "back" | "left" | "mid" | "right";
const COLUMN_ORDER: ColumnId[] = ["back", "left", "mid", "right"];

const COLUMN_OF: Record<SceneNodeKind, { col: ColumnId; group: number }> = {
  webhook: { col: "back", group: 0 },
  trigger: { col: "left", group: 0 },
  subscription: { col: "left", group: 1 },
  agent: { col: "mid", group: 0 },
  connection: { col: "right", group: 0 },
  repo: { col: "right", group: 1 },
};

const COLUMNS: Record<
  ColumnId,
  { x: number; z: number; spacing: number; bulgeX: number; bulgeZ: number }
> = {
  back: { x: -16, z: -14, spacing: 2.4, bulgeX: 1.2, bulgeZ: 0 },
  left: { x: -10.5, z: -7.5, spacing: 2.5, bulgeX: 1.8, bulgeZ: 0.8 },
  mid: { x: 0, z: 0, spacing: 3.2, bulgeX: 0, bulgeZ: 1.6 },
  right: { x: 10.5, z: 7.5, spacing: 2.5, bulgeX: -1.8, bulgeZ: 0.8 },
};

const GROUP_GAP = 1.1;

/** Deterministic PRNG — layout jitter is keyed by node id so positions are
 *  identical across polls and mounts. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

// ── Scene graph model ────────────────────────────────────────────────

interface SceneNodeMeta {
  key: string;
  rawId: string;
  kind: SceneNodeKind;
  label: string;
  subLabel: string;
  running: boolean;
}

interface LaidNode extends SceneNodeMeta {
  x: number;
  y: number;
  z: number;
  size: number;
  glow: number;
  color: THREE.Color;
  dotColor: string;
}

interface ResolvedEdge {
  a: number;
  b: number;
  running: boolean;
  color: THREE.Color;
}

interface BuiltScene {
  nodes: LaidNode[];
  edges: ResolvedEdge[];
  signature: string;
}

/** GraphDTO → laid-out scene nodes + resolved edges. Mirrors the wiring the
 *  2D canvas drew: trigger→agent, subscription→agent, webhook→subscription,
 *  agent→agent (delegation), agent→repo, connection→agent (grant),
 *  agent→subscription (emit). Pure and deterministic. */
function buildScene(d: GraphDTO): BuiltScene {
  const runningSources = new Set(
    d.runningSessions.map((s) => `${s.agentConfigId}:${s.source}`),
  );
  const agentIds = new Set(d.agents.map((a) => a.id));

  const metas: SceneNodeMeta[] = [];
  for (const t of d.triggers) {
    metas.push({
      key: t.id,
      rawId: t.id,
      kind: "trigger",
      label: t.label,
      subLabel: `${t.kind === "linear" ? "Linear" : "Schedule"} · ${t.subLabel}`,
      running: runningSources.has(`${t.agentConfigId}:${t.kind}`),
    });
  }
  for (const t of d.eventTriggers) {
    metas.push({
      key: t.id,
      rawId: t.id,
      kind: t.kind,
      label: t.label,
      subLabel: `${t.kind === "subscription" ? "Subscription" : "Webhook"} · ${t.subLabel}`,
      running: t.running,
    });
  }
  for (const a of d.agents) {
    const bits = [`Agent · ${shortModel(a.model)}`];
    if (a.runningCount > 0) bits.push(`${a.runningCount} live`);
    if (a.todayCostUsd > 0) bits.push(`$${a.todayCostUsd.toFixed(2)} today`);
    metas.push({
      key: a.id,
      rawId: a.id,
      kind: "agent",
      label: a.name,
      subLabel: bits.join(" · "),
      running: a.runningCount > 0,
    });
  }
  for (const r of d.repos) {
    metas.push({
      key: `repo:${r.id}`,
      rawId: r.id,
      kind: "repo",
      label: r.slug,
      subLabel: `Repo · ${r.githubRepo}`,
      running: false,
    });
  }
  for (const c of d.connections) {
    metas.push({
      key: `conn:${c.id}`,
      rawId: c.id,
      kind: "connection",
      label: c.name,
      subLabel: `Connection · ${c.kind}`,
      running: false,
    });
  }

  // Bucket into depth-plane columns; sort deterministically so polls never
  // reshuffle (group, then label, then id as tiebreaker).
  const byColumn = new Map<ColumnId, SceneNodeMeta[]>();
  for (const m of metas) {
    const col = COLUMN_OF[m.kind].col;
    const list = byColumn.get(col);
    if (list) list.push(m);
    else byColumn.set(col, [m]);
  }
  const cmp = (p: SceneNodeMeta, q: SceneNodeMeta) => {
    const g = COLUMN_OF[p.kind].group - COLUMN_OF[q.kind].group;
    if (g !== 0) return g;
    const l = p.label.toLowerCase().localeCompare(q.label.toLowerCase());
    if (l !== 0) return l;
    return p.key < q.key ? -1 : p.key > q.key ? 1 : 0;
  };

  const nodes: LaidNode[] = [];
  for (const col of COLUMN_ORDER) {
    const list = (byColumn.get(col) ?? []).sort(cmp);
    const n = list.length;
    if (n === 0) continue;
    const conf = COLUMNS[col];
    let gaps = 0;
    for (let i = 1; i < n; i++) {
      if (COLUMN_OF[list[i].kind].group !== COLUMN_OF[list[i - 1].kind].group)
        gaps++;
    }
    const totalH = (n - 1) * conf.spacing + gaps * GROUP_GAP;
    let y = totalH / 2;
    for (let i = 0; i < n; i++) {
      const m = list[i];
      if (i > 0) {
        y -= conf.spacing;
        if (COLUMN_OF[m.kind].group !== COLUMN_OF[list[i - 1].kind].group)
          y -= GROUP_GAP;
      }
      const t = n > 1 ? i / (n - 1) - 0.5 : 0;
      const bulge = 1 - 4 * t * t; // calm arc — max at column middle
      const rand = mulberry32(hashStr(m.key));
      const jx = (rand() - 0.5) * 0.9;
      const jy = (rand() - 0.5) * 0.7;
      const jz = (rand() - 0.5) * 1.6;
      const vis = KIND_VISUAL[m.kind];
      const runningAgent = m.kind === "agent" && m.running;
      const color = new THREE.Color(runningAgent ? AGENT_RUNNING : vis.color);
      if (!runningAgent) color.multiplyScalar(vis.dim);
      nodes.push({
        ...m,
        x: conf.x + conf.bulgeX * bulge + jx,
        y: y + jy,
        z: conf.z + conf.bulgeZ * bulge + jz,
        size: vis.size,
        glow: m.running ? (m.kind === "agent" ? 1 : 0.55) : 0,
        color,
        dotColor: m.running ? LIVE : vis.color,
      });
    }
  }

  const index = new Map<string, number>();
  nodes.forEach((nd, i) => index.set(nd.key, i));

  const edges: ResolvedEdge[] = [];
  const push = (
    fromKey: string,
    toKey: string,
    family: EdgeFamily,
    running: boolean,
  ) => {
    const a = index.get(fromKey);
    const b = index.get(toKey);
    if (a === undefined || b === undefined) return;
    const color = running
      ? EDGE_RUN_COLOR.clone()
      : new THREE.Color(EDGE_TONE[family]).multiplyScalar(EDGE_STATIC[family]);
    edges.push({ a, b, running, color });
  };

  for (const t of d.triggers) {
    push(
      t.id,
      t.agentConfigId,
      "trigger",
      runningSources.has(`${t.agentConfigId}:${t.kind}`),
    );
  }
  for (const e of d.delegationEdges)
    push(e.fromAgentId, e.toAgentId, "delegation", e.running);
  for (const e of d.repoEdges)
    push(e.agentConfigId, `repo:${e.repoId}`, "repo", e.running);
  for (const g of d.grantEdges) {
    if (!agentIds.has(g.agentConfigId)) continue;
    push(`conn:${g.connectionId}`, g.agentConfigId, "grant", false);
  }
  const subs = d.eventTriggers.filter((t) => t.kind === "subscription");
  const hooks = d.eventTriggers.filter((t) => t.kind === "webhook");
  for (const s of subs) {
    if (s.agentConfigId) push(s.id, s.agentConfigId, "event", s.running);
  }
  for (const h of hooks) {
    for (const s of subs) {
      if (topicMatches(s.topic, h.topic)) push(h.id, s.id, "wire", false);
    }
  }
  for (const e of d.emitEdges) {
    if (!agentIds.has(e.agentConfigId)) continue;
    for (const s of subs) {
      if (topicMatches(s.topic, e.topic)) push(e.agentConfigId, s.id, "emit", false);
    }
  }

  const signature =
    nodes
      .map((n) => `${n.key};${n.label};${n.subLabel};${n.running ? 1 : 0}`)
      .join("|") +
    "§" +
    edges.map((e) => `${e.a}-${e.b}-${e.running ? 1 : 0}`).join("|");

  return { nodes, edges, signature };
}

// ── Shaders (same idiom as AgentConstellation) ───────────────────────

const NODE_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aGlow;
  attribute float aBoost;
  uniform float uPixelRatio;
  uniform float uTime;
  varying vec3 vColor;
  varying float vFade;
  varying float vGlow;
  varying float vBoost;
  void main() {
    vColor = aColor;
    vGlow = aGlow;
    vBoost = aBoost;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = -mv.z;
    // Depth fade — the back plane reads dimmer, giving the scene volume.
    vFade = clamp((80.0 - dist) / 50.0, 0.35, 1.0);
    float pulse = 1.0 + aGlow * 0.14 * sin(uTime * 2.1 + position.y * 1.7);
    float breathe = 1.0 + 0.03 * sin(uTime * 0.6 + position.x * 0.35);
    float size = aSize * (1.0 + aGlow * 0.5 + aBoost * 0.3) * pulse * breathe;
    gl_PointSize = size * uPixelRatio * (340.0 / max(dist, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const NODE_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vFade;
  varying float vGlow;
  varying float vBoost;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    // Running/hovered orbs get a wider halo (lower exponent) + extra ring.
    float body = pow(core, 2.6 - vGlow * 0.9 - vBoost * 0.5);
    float halo = pow(core, 1.15) * (vGlow * 0.4 + vBoost * 0.25);
    vec3 col = mix(vColor, vec3(1.0), (vGlow * 0.2 + vBoost * 0.15) * core);
    gl_FragColor = vec4(col, (body + halo) * uOpacity * vFade);
  }
`;

const PULSE_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = -mv.z;
    vFade = clamp((80.0 - dist) / 50.0, 0.35, 1.0);
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (340.0 / max(dist, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const PULSE_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float glow = pow(core, 2.0);
    // White-hot centre so a pulse reads as a spark of light on the wire.
    vec3 col = mix(vColor, vec3(1.0), glow * 0.55);
    gl_FragColor = vec4(col, glow * uOpacity * vFade);
  }
`;

// ── Camera defaults ──────────────────────────────────────────────────

const DEFAULT_YAW = 0.26;
const DEFAULT_PITCH = 0.16;
const BASE_DIST = 38;
const MIN_DIST = 14;
const MAX_DIST = 70;
const MIN_PITCH = -0.45;
const MAX_PITCH = 0.85;
const IDLE_MS = 3000;
const MAX_PULSES = 28;

const CHIP_CSS = `
.cc3d-labels{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2}
.cc3d-chip{position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;appearance:none;display:flex;flex-direction:column;align-items:center;gap:1px;transform-origin:top center;background:rgba(15,15,18,0.78);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:3px 8px 4px;max-width:172px;color:var(--fg,#ededee);font:inherit;font-size:11px;line-height:1.25;font-weight:550;white-space:nowrap;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.cc3d-chip-name{display:block;max-width:156px;overflow:hidden;text-overflow:ellipsis}
.cc3d-chip-sub{display:flex;align-items:center;gap:4px;max-width:156px;overflow:hidden;font-size:9.5px;font-weight:450;color:var(--fg-muted,#a1a1a8)}
.cc3d-chip-subtext{overflow:hidden;text-overflow:ellipsis}
.cc3d-dot{width:5px;height:5px;border-radius:999px;flex:none}
.cc3d-chip.is-live .cc3d-dot{animation:cc3d-pulse 1.6s ease-in-out infinite}
.cc3d-chip:hover,.cc3d-chip.is-hover{border-color:rgba(255,255,255,0.2);color:#fff}
.cc3d-chip.is-selected{border-color:rgba(91,141,239,0.65);box-shadow:0 0 0 1px rgba(91,141,239,0.35),0 4px 16px -6px rgba(0,0,0,0.6)}
.cc3d-chip:focus-visible{outline:2px solid var(--accent,#5b8def);outline-offset:1px}
.cc3d-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--fg-subtle,#6b6b73)}
@keyframes cc3d-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){.cc3d-chip.is-live .cc3d-dot{animation:none}}
`;

interface InternalApi {
  setGraph(d: GraphDTO): void;
  setSelected(id: string | null): void;
  resetView(): void;
}

export default function ControlCanvas3D({
  data,
  selectedId,
  onPick,
  onBackgroundClick,
  className,
  ref,
}: ControlCanvas3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<InternalApi | null>(null);
  const onPickRef = useRef(onPick);
  const onBackgroundRef = useRef(onBackgroundClick);

  useEffect(() => {
    onPickRef.current = onPick;
    onBackgroundRef.current = onBackgroundClick;
  }, [onPick, onBackgroundClick]);

  useImperativeHandle(
    ref,
    () => ({ resetView: () => apiRef.current?.resetView() }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      // No WebGL — degrade to a quiet message; the rest of the page works.
      const fallback = document.createElement("div");
      fallback.className = "cc3d-fallback";
      fallback.textContent = "3D view unavailable on this device.";
      container.appendChild(fallback);
      return () => fallback.remove();
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    renderer.setPixelRatio(dpr());
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);

    const labelLayer = document.createElement("div");
    labelLayer.className = "cc3d-labels";
    container.appendChild(labelLayer);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);
    const TARGET = new THREE.Vector3(-1.2, 0, -1.5);

    // ── Camera rig — damped orbit around TARGET ─────────────────────
    let defaultDist = BASE_DIST;
    let yawT = DEFAULT_YAW;
    let pitchT = DEFAULT_PITCH;
    let distT = defaultDist;
    let yaw = yawT;
    let pitch = pitchT;
    let dist = distT;
    let userZoomed = false;
    let driftDir = 1;
    let lastInteract = performance.now();

    function updateCamera() {
      camera.position.set(
        TARGET.x + dist * Math.sin(yaw) * Math.cos(pitch),
        TARGET.y + dist * Math.sin(pitch),
        TARGET.z + dist * Math.cos(yaw) * Math.cos(pitch),
      );
      camera.lookAt(TARGET);
    }

    // ── Shared materials (one each — 3 draw calls total) ────────────
    const uPixelRatio = { value: dpr() };
    const uTime = { value: 1.3 };

    const nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio,
        uTime,
        uOpacity: { value: 0.95 },
      },
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const pulseMat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio,
        uSizeScale: { value: 1.6 },
        uOpacity: { value: 1.0 },
      },
      vertexShader: PULSE_VERT,
      fragmentShader: PULSE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const edgeLines = new THREE.LineSegments(new THREE.BufferGeometry(), edgeMat);
    const nodePoints = new THREE.Points(new THREE.BufferGeometry(), nodeMat);
    const pulsePoints = new THREE.Points(new THREE.BufferGeometry(), pulseMat);
    for (const o of [edgeLines, nodePoints, pulsePoints]) o.frustumCulled = false;
    edgeLines.renderOrder = 0;
    nodePoints.renderOrder = 1;
    pulsePoints.renderOrder = 2;
    scene.add(edgeLines, nodePoints, pulsePoints);

    // ── Scene state (rebuilt when the graph signature changes) ──────
    let nodes: LaidNode[] = [];
    let index = new Map<string, number>();
    let boostAttr: THREE.BufferAttribute | null = null;
    let chipEls: HTMLButtonElement[] = [];
    const chipByKey = new Map<string, HTMLButtonElement>();
    let signature = "";
    let selKey: string | null = null;
    let selIdx = -1;
    let hoverIdx = -1;

    // Pulses travel along running edges only.
    const rand = mulberry32(0x51ed270b);
    let pulseCount = 0;
    let pulseSegs = new Float32Array(0); // 6 floats per running edge (a→b)
    let pulseEdge = new Int32Array(0);
    let pT = new Float32Array(0);
    let pSpeed = new Float32Array(0);
    let pCooldown = new Float32Array(0);
    let pulsePosAttr: THREE.BufferAttribute | null = null;
    let pulseSizeAttr: THREE.BufferAttribute | null = null;

    const smooth = (t: number) => t * t * (3 - 2 * t);

    function stepPulses(dt: number) {
      if (!pulseCount || !pulsePosAttr || !pulseSizeAttr) return;
      const pos = pulsePosAttr.array as Float32Array;
      const sizes = pulseSizeAttr.array as Float32Array;
      for (let p = 0; p < pulseCount; p++) {
        if (pCooldown[p] > 0) {
          pCooldown[p] -= dt;
          sizes[p] = 0;
          continue;
        }
        pT[p] += pSpeed[p] * dt;
        if (pT[p] >= 1) {
          pT[p] = 0;
          pSpeed[p] = 0.22 + rand() * 0.2;
          pCooldown[p] = 0.35 + rand() * 1.4;
          sizes[p] = 0;
          continue;
        }
        const e = pulseEdge[p] * 6;
        const s = smooth(pT[p]);
        pos[p * 3] = pulseSegs[e] + (pulseSegs[e + 3] - pulseSegs[e]) * s;
        pos[p * 3 + 1] =
          pulseSegs[e + 1] + (pulseSegs[e + 4] - pulseSegs[e + 1]) * s;
        pos[p * 3 + 2] =
          pulseSegs[e + 2] + (pulseSegs[e + 5] - pulseSegs[e + 2]) * s;
        sizes[p] = 1.5 * Math.sin(Math.PI * pT[p]);
      }
      pulsePosAttr.needsUpdate = true;
      pulseSizeAttr.needsUpdate = true;
    }

    /** Static, presentable pulse frame — used for reduced motion. */
    function seedStaticPulses() {
      if (!pulseCount || !pulsePosAttr || !pulseSizeAttr) return;
      const pos = pulsePosAttr.array as Float32Array;
      const sizes = pulseSizeAttr.array as Float32Array;
      for (let p = 0; p < pulseCount; p++) {
        const t = (p * 0.37 + 0.3) % 1;
        const e = pulseEdge[p] * 6;
        const s = smooth(t);
        pos[p * 3] = pulseSegs[e] + (pulseSegs[e + 3] - pulseSegs[e]) * s;
        pos[p * 3 + 1] =
          pulseSegs[e + 1] + (pulseSegs[e + 4] - pulseSegs[e + 1]) * s;
        pos[p * 3 + 2] =
          pulseSegs[e + 2] + (pulseSegs[e + 5] - pulseSegs[e + 2]) * s;
        sizes[p] = 1.3 * Math.sin(Math.PI * t);
      }
      pulsePosAttr.needsUpdate = true;
      pulseSizeAttr.needsUpdate = true;
    }

    function swapGeometry(
      obj: THREE.Points | THREE.LineSegments,
      geom: THREE.BufferGeometry,
    ) {
      const old = obj.geometry as THREE.BufferGeometry;
      obj.geometry = geom;
      old.dispose();
    }

    function pickByKey(key: string) {
      const i = index.get(key);
      if (i === undefined) return;
      const n = nodes[i];
      onPickRef.current({ kind: n.kind, id: n.rawId });
    }

    function refreshBoost() {
      if (boostAttr) {
        const arr = boostAttr.array as Float32Array;
        for (let i = 0; i < arr.length; i++)
          arr[i] = i === selIdx || i === hoverIdx ? 1 : 0;
        boostAttr.needsUpdate = true;
      }
      for (let i = 0; i < chipEls.length; i++) {
        chipEls[i].classList.toggle("is-selected", i === selIdx);
        chipEls[i].classList.toggle("is-hover", i === hoverIdx);
      }
      requestRender();
    }

    function setHover(i: number) {
      if (hoverIdx === i) return;
      hoverIdx = i;
      refreshBoost();
    }

    function makeChip(key: string): HTMLButtonElement {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "cc3d-chip";
      el.dataset.key = key;
      const name = document.createElement("span");
      name.className = "cc3d-chip-name";
      const sub = document.createElement("span");
      sub.className = "cc3d-chip-sub";
      const dot = document.createElement("span");
      dot.className = "cc3d-dot";
      dot.setAttribute("aria-hidden", "true");
      const subText = document.createElement("span");
      subText.className = "cc3d-chip-subtext";
      sub.append(dot, subText);
      el.append(name, sub);
      // Keyboard activation only — pointer taps route through the container's
      // unified pointerup so drags starting on a chip still orbit.
      el.addEventListener("click", (ev) => {
        if (ev.detail === 0 && el.dataset.key) pickByKey(el.dataset.key);
      });
      el.addEventListener("focus", () => {
        const i = el.dataset.key ? (index.get(el.dataset.key) ?? -1) : -1;
        setHover(i);
      });
      el.addEventListener("blur", () => setHover(-1));
      labelLayer.appendChild(el);
      return el;
    }

    function rebuild(d: GraphDTO) {
      const built = buildScene(d);
      if (built.signature === signature) return;
      signature = built.signature;
      nodes = built.nodes;
      index = new Map();
      nodes.forEach((nd, i) => index.set(nd.key, i));

      const n = nodes.length;

      // Nodes — one Points geometry.
      const positions = new Float32Array(n * 3);
      const colors = new Float32Array(n * 3);
      const sizes = new Float32Array(n);
      const glows = new Float32Array(n);
      const boosts = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const nd = nodes[i];
        positions[i * 3] = nd.x;
        positions[i * 3 + 1] = nd.y;
        positions[i * 3 + 2] = nd.z;
        colors[i * 3] = nd.color.r;
        colors[i * 3 + 1] = nd.color.g;
        colors[i * 3 + 2] = nd.color.b;
        sizes[i] = nd.size;
        glows[i] = nd.glow;
      }
      const nodeGeom = new THREE.BufferGeometry();
      nodeGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      nodeGeom.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
      nodeGeom.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
      nodeGeom.setAttribute("aGlow", new THREE.BufferAttribute(glows, 1));
      boostAttr = new THREE.BufferAttribute(boosts, 1);
      boostAttr.setUsage(THREE.DynamicDrawUsage);
      nodeGeom.setAttribute("aBoost", boostAttr);
      swapGeometry(nodePoints, nodeGeom);

      // Edges — one LineSegments geometry, per-vertex colors.
      const e = built.edges.length;
      const linePos = new Float32Array(e * 6);
      const lineCol = new Float32Array(e * 6);
      const runSegs: number[] = [];
      for (let i = 0; i < e; i++) {
        const ed = built.edges[i];
        const a = nodes[ed.a];
        const b = nodes[ed.b];
        linePos[i * 6] = a.x;
        linePos[i * 6 + 1] = a.y;
        linePos[i * 6 + 2] = a.z;
        linePos[i * 6 + 3] = b.x;
        linePos[i * 6 + 4] = b.y;
        linePos[i * 6 + 5] = b.z;
        for (const off of [0, 3]) {
          lineCol[i * 6 + off] = ed.color.r;
          lineCol[i * 6 + off + 1] = ed.color.g;
          lineCol[i * 6 + off + 2] = ed.color.b;
        }
        if (ed.running) runSegs.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const edgeGeom = new THREE.BufferGeometry();
      edgeGeom.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
      edgeGeom.setAttribute("color", new THREE.BufferAttribute(lineCol, 3));
      swapGeometry(edgeLines, edgeGeom);

      // Pulses — sparks along running edges.
      pulseSegs = new Float32Array(runSegs);
      const runCount = runSegs.length / 6;
      pulseCount = runCount ? Math.min(MAX_PULSES, runCount * 2) : 0;
      pulseEdge = new Int32Array(pulseCount);
      pT = new Float32Array(pulseCount);
      pSpeed = new Float32Array(pulseCount);
      pCooldown = new Float32Array(pulseCount);
      const pulsePos = new Float32Array(pulseCount * 3);
      const pulseCol = new Float32Array(pulseCount * 3);
      const pulseSize = new Float32Array(pulseCount);
      for (let p = 0; p < pulseCount; p++) {
        pulseEdge[p] = p % runCount;
        pT[p] = rand();
        pSpeed[p] = 0.22 + rand() * 0.2;
        pCooldown[p] = rand() * 1.2;
        pulseCol[p * 3] = PULSE_COLOR.r;
        pulseCol[p * 3 + 1] = PULSE_COLOR.g;
        pulseCol[p * 3 + 2] = PULSE_COLOR.b;
      }
      const pulseGeom = new THREE.BufferGeometry();
      pulsePosAttr = new THREE.BufferAttribute(pulsePos, 3);
      pulsePosAttr.setUsage(THREE.DynamicDrawUsage);
      pulseSizeAttr = new THREE.BufferAttribute(pulseSize, 1);
      pulseSizeAttr.setUsage(THREE.DynamicDrawUsage);
      pulseGeom.setAttribute("position", pulsePosAttr);
      pulseGeom.setAttribute("aColor", new THREE.BufferAttribute(pulseCol, 3));
      pulseGeom.setAttribute("aSize", pulseSizeAttr);
      swapGeometry(pulsePoints, pulseGeom);
      seedStaticPulses();

      // Labels — diff DOM chips by node key.
      const liveKeys = new Set(nodes.map((nd) => nd.key));
      for (const [key, el] of chipByKey) {
        if (!liveKeys.has(key)) {
          el.remove();
          chipByKey.delete(key);
        }
      }
      chipEls = nodes.map((nd) => {
        let el = chipByKey.get(nd.key);
        if (!el) {
          el = makeChip(nd.key);
          chipByKey.set(nd.key, el);
        }
        (el.children[0] as HTMLElement).textContent = nd.label;
        const sub = el.children[1] as HTMLElement;
        (sub.children[0] as HTMLElement).style.background = nd.dotColor;
        (sub.children[1] as HTMLElement).textContent = nd.subLabel;
        el.classList.toggle("is-live", nd.running);
        el.setAttribute(
          "aria-label",
          `${nd.label} — ${nd.subLabel}${nd.running ? " (live)" : ""}`,
        );
        return el;
      });

      hoverIdx = -1;
      selIdx = selKey ? (index.get(selKey) ?? -1) : -1;
      refreshBoost();
      requestRender();
    }

    // ── DOM label projection ─────────────────────────────────────────
    const proj = new THREE.Vector3();
    function updateLabels() {
      const w = width;
      const h = height;
      if (!w || !h) return;
      const cp = camera.position;
      for (let i = 0; i < nodes.length; i++) {
        const el = chipEls[i];
        if (!el) continue;
        const nd = nodes[i];
        proj.set(nd.x, nd.y, nd.z).project(camera);
        if (proj.z > 1) {
          el.style.display = "none";
          continue;
        }
        const sx = (proj.x * 0.5 + 0.5) * w;
        const sy = (-proj.y * 0.5 + 0.5) * h;
        if (sx < -90 || sx > w + 90 || sy < -50 || sy > h + 70) {
          el.style.display = "none";
          continue;
        }
        const dx = cp.x - nd.x;
        const dy = cp.y - nd.y;
        const dz = cp.z - nd.z;
        const depth = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const s = clamp(1.32 - depth / 85, 0.62, 1.04);
        const o =
          i === hoverIdx || i === selIdx
            ? 1
            : clamp(1.45 - depth / 62, 0.38, 1);
        const off = 7 + nd.size * 3.2 * s;
        el.style.display = "";
        el.style.zIndex = String(Math.max(1, 1000 - Math.round(depth * 8)));
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, ${off.toFixed(1)}px) scale(${s.toFixed(3)})`;
      }
    }

    // ── Render loop / render-on-demand ───────────────────────────────
    const clock = new THREE.Clock();
    let raf = 0;
    let running = false;
    let staticRaf = 0;
    let staticQueued = false;

    function renderFrame() {
      renderer.render(scene, camera);
      updateLabels();
    }

    /** Reduced motion: one snapped frame per user action instead of a loop. */
    function requestRender() {
      if (!reduceMotion) return;
      if (staticQueued) return;
      staticQueued = true;
      staticRaf = requestAnimationFrame(() => {
        staticQueued = false;
        yaw = yawT;
        pitch = pitchT;
        dist = distT;
        updateCamera();
        renderFrame();
      });
    }

    function loop() {
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      // Gentle auto-drift when idle >3s — a slow pendulum around the default
      // yaw, so an abandoned tab always eases back to a sane vantage.
      if (performance.now() - lastInteract > IDLE_MS) {
        yawT += dt * 0.02 * driftDir;
        if (yawT > DEFAULT_YAW + 0.45) driftDir = -1;
        else if (yawT < DEFAULT_YAW - 0.45) driftDir = 1;
      }
      const k = 1 - Math.exp(-dt * 7);
      yaw += (yawT - yaw) * k;
      pitch += (pitchT - pitch) * k;
      dist += (distT - dist) * k;
      updateCamera();
      uTime.value = t + 1.3;
      stepPulses(dt);
      renderFrame();
      raf = requestAnimationFrame(loop);
    }
    function start() {
      if (running || reduceMotion) return;
      running = true;
      clock.getDelta(); // swallow the paused gap
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    // ── Sizing ───────────────────────────────────────────────────────
    let width = 0;
    let height = 0;
    function resize() {
      const w = container!.clientWidth || 1;
      const h = container!.clientHeight || 1;
      if (w === width && h === height) return;
      width = w;
      height = h;
      const ratio = dpr();
      uPixelRatio.value = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Portrait phones need to sit further back to frame all three planes.
      defaultDist = Math.min(
        BASE_DIST / Math.min(1, Math.pow(w / h, 0.7)),
        62,
      );
      if (!userZoomed) distT = defaultDist;
      if (reduceMotion) requestRender();
    }

    // ── Interaction — orbit / pinch / wheel / tap / hover ────────────
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 1.3;
    const ndc = new THREE.Vector2();
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = false;
    let downX = 0;
    let downY = 0;
    let downChipKey: string | null = null;
    let pinchDist = 0;

    function markInteraction() {
      lastInteract = performance.now();
    }

    function raycastIndex(clientX: number, clientY: number): number {
      const r = container!.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return -1;
      ndc.set(
        ((clientX - r.left) / r.width) * 2 - 1,
        -(((clientY - r.top) / r.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(nodePoints, false);
      for (const hit of hits) {
        if (hit.index !== undefined && hit.index < nodes.length)
          return hit.index;
      }
      return -1;
    }

    function chipKeyFromTarget(target: EventTarget | null): string | null {
      if (!(target instanceof Element)) return null;
      const chip = target.closest<HTMLElement>(".cc3d-chip");
      return chip?.dataset.key ?? null;
    }

    function onPointerDown(e: PointerEvent) {
      // Record the chip under the finger now — pointer capture retargets
      // the matching pointerup to the container.
      if (pointers.size === 0) {
        downChipKey = chipKeyFromTarget(e.target);
        downX = e.clientX;
        downY = e.clientY;
        moved = false;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        container!.setPointerCapture(e.pointerId);
      } catch {
        // ignore — capture is best-effort
      }
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        moved = true;
      }
      markInteraction();
    }

    function onPointerMove(e: PointerEvent) {
      const p = pointers.get(e.pointerId);
      if (!p) {
        // No buttons down — hover path (fine pointers).
        const chipKey = chipKeyFromTarget(e.target);
        const i =
          chipKey !== null
            ? (index.get(chipKey) ?? -1)
            : raycastIndex(e.clientX, e.clientY);
        setHover(i);
        container!.style.cursor = i >= 0 ? "pointer" : "grab";
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 1) {
        if (
          Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6
        )
          moved = true;
        if (moved) container!.style.cursor = "grabbing";
        yawT -= dx * 0.005;
        pitchT = clamp(pitchT + dy * 0.004, MIN_PITCH, MAX_PITCH);
      } else if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (pinchDist > 0 && d > 0) {
          distT = clamp(distT * (pinchDist / d), MIN_DIST, MAX_DIST);
          userZoomed = true;
        }
        pinchDist = d;
      }
      markInteraction();
      requestRender();
    }

    function onPointerUp(e: PointerEvent) {
      const wasTracked = pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (wasTracked && pointers.size === 0) {
        container!.style.cursor = "grab";
        if (!moved) {
          if (downChipKey) {
            pickByKey(downChipKey);
          } else {
            const i = raycastIndex(e.clientX, e.clientY);
            if (i >= 0) {
              const n = nodes[i];
              onPickRef.current({ kind: n.kind, id: n.rawId });
            } else {
              onBackgroundRef.current?.();
            }
          }
        }
        downChipKey = null;
      }
      markInteraction();
    }

    function onPointerCancel(e: PointerEvent) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) {
        downChipKey = null;
        container!.style.cursor = "grab";
      }
    }

    function onPointerLeave() {
      if (pointers.size === 0) setHover(-1);
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      distT = clamp(distT * Math.exp(e.deltaY * 0.0012), MIN_DIST, MAX_DIST);
      userZoomed = true;
      markInteraction();
      requestRender();
    }

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerCancel);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("wheel", onWheel, { passive: false });

    // ── Boot ─────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => resize());
    ro.observe(container);
    resize();
    updateCamera();

    if (reduceMotion) {
      requestRender();
    } else {
      document.addEventListener("visibilitychange", onVisibility);
      if (!document.hidden) start();
    }

    apiRef.current = {
      setGraph: rebuild,
      setSelected(id: string | null) {
        selKey = id;
        selIdx = id ? (index.get(id) ?? -1) : -1;
        refreshBoost();
      },
      resetView() {
        yawT = DEFAULT_YAW;
        pitchT = DEFAULT_PITCH;
        distT = defaultDist;
        userZoomed = false;
        driftDir = 1;
        markInteraction();
        requestRender();
      },
    };

    // ── Cleanup ──────────────────────────────────────────────────────
    return () => {
      apiRef.current = null;
      stop();
      if (staticRaf) cancelAnimationFrame(staticRaf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("wheel", onWheel);
      nodePoints.geometry.dispose();
      edgeLines.geometry.dispose();
      pulsePoints.geometry.dispose();
      nodeMat.dispose();
      edgeMat.dispose();
      pulseMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      labelLayer.remove();
      chipByKey.clear();
    };
  }, []);

  useEffect(() => {
    apiRef.current?.setGraph(data);
  }, [data]);

  useEffect(() => {
    apiRef.current?.setSelected(selectedId);
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Workspace control graph — drag to orbit, scroll or pinch to zoom, click a node to open it"
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        touchAction: "none",
        cursor: "grab",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <style>{CHIP_CSS}</style>
    </div>
  );
}
