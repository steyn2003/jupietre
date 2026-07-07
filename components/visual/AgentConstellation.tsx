"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * AgentConstellation — an ambient 3D "agent network": glowing nodes (agents)
 * wired by faint hairlines, with pulses of light travelling along edges (work
 * flowing through the system). Calm, expensive infrastructure — not a particle
 * demo. Palette is pulled straight from the design tokens (accent #5b8def /
 * accent-strong #79a3ff) over the near-black #0b0b0c background.
 *
 * This is the heavy, WebGL-touching component. It must only ever be mounted on
 * the client (WebGL needs `window`), so it is imported through
 * `ConstellationBackground` which wraps it in `next/dynamic({ ssr: false })`.
 *
 * Budget (hard): 3 draw calls total — one THREE.Points for nodes, one
 * THREE.LineSegments for every edge (single BufferGeometry), one THREE.Points
 * for the travelling pulses. No lights, no shadows, no postprocessing.
 */
export interface AgentConstellationProps {
  className?: string;
  /** 0..1 — scales node/edge count. 1 ≈ 160 nodes. Default 1. */
  density?: number;
  /** 0..1 — overall brightness/opacity of the whole scene. Default 1. */
  intensity?: number;
  /** Subtle pointer parallax (desktop / fine-pointer only). Default true. */
  interactive?: boolean;
}

const ACCENT = new THREE.Color("#5b8def");
const ACCENT_STRONG = new THREE.Color("#79a3ff");

/** Deterministic PRNG so the constellation looks identical on every mount. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const NODE_VERT = /* glsl */ `
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
    // Depth fade — nearer nodes read brighter, giving the cloud volume.
    vFade = clamp((42.0 - dist) / 26.0, 0.2, 1.0);
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (320.0 / dist);
    gl_Position = projectionMatrix * mv;
  }
`;

const NODE_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float glow = pow(core, 2.4);
    gl_FragColor = vec4(vColor, glow * uOpacity * vFade);
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

export default function AgentConstellation({
  className,
  density = 1,
  intensity = 1,
  interactive = true,
}: AgentConstellationProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
      // No WebGL — fail silently, the page just gets its plain background.
      return;
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const finePointer =
      interactive && window.matchMedia("(pointer: fine)").matches;

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    renderer.setPixelRatio(dpr());
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, 26);

    const group = new THREE.Group();
    scene.add(group);

    // ── Nodes ────────────────────────────────────────────────────────────
    const NODE_COUNT = Math.max(48, Math.round(160 * clamp01(density)));
    const RX = 22,
      RY = 13,
      RZ = 8;
    const rand = mulberry32(0x9e3779b9);

    const positions = new Float32Array(NODE_COUNT * 3);
    const nodeColors = new Float32Array(NODE_COUNT * 3);
    const nodeSizes = new Float32Array(NODE_COUNT);

    for (let i = 0; i < NODE_COUNT; i++) {
      const x = (rand() * 2 - 1) * RX;
      const y = (rand() * 2 - 1) * RY;
      const z = (rand() * 2 - 1) * RZ;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const c = ACCENT.clone().lerp(ACCENT_STRONG, rand());
      nodeColors[i * 3] = c.r;
      nodeColors[i * 3 + 1] = c.g;
      nodeColors[i * 3 + 2] = c.b;

      // Most nodes small, a few brighter "hub" nodes for hierarchy.
      nodeSizes[i] = rand() < 0.12 ? 1.5 + rand() * 1.1 : 0.55 + rand() * 0.7;
    }

    // ── Edges — nearest-neighbour wiring, capped so it stays sparse ───────
    const CONNECT_DIST = 6.5;
    const MAX_PER_NODE = 3;
    const edges: Array<[number, number]> = [];
    const seen = new Set<string>();
    const dist2 = (a: number, b: number) => {
      const dx = positions[a * 3] - positions[b * 3];
      const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
      const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
      return dx * dx + dy * dy + dz * dz;
    };
    const maxD2 = CONNECT_DIST * CONNECT_DIST;
    for (let i = 0; i < NODE_COUNT; i++) {
      const cand: Array<{ j: number; d: number }> = [];
      for (let j = 0; j < NODE_COUNT; j++) {
        if (j === i) continue;
        const d = dist2(i, j);
        if (d < maxD2) cand.push({ j, d });
      }
      cand.sort((p, q) => p.d - q.d);
      let added = 0;
      for (const c of cand) {
        if (added >= MAX_PER_NODE) break;
        const key = i < c.j ? `${i}-${c.j}` : `${c.j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([i, c.j]);
        added++;
      }
    }

    const linePositions = new Float32Array(edges.length * 2 * 3);
    for (let e = 0; e < edges.length; e++) {
      const [a, b] = edges[e];
      linePositions[e * 6] = positions[a * 3];
      linePositions[e * 6 + 1] = positions[a * 3 + 1];
      linePositions[e * 6 + 2] = positions[a * 3 + 2];
      linePositions[e * 6 + 3] = positions[b * 3];
      linePositions[e * 6 + 4] = positions[b * 3 + 1];
      linePositions[e * 6 + 5] = positions[b * 3 + 2];
    }

    // ── Pulses — sparks that travel node → node along an edge ─────────────
    const PULSE_COUNT = edges.length
      ? Math.min(edges.length, Math.max(4, Math.round(12 * clamp01(density))))
      : 0;
    const pulsePositions = new Float32Array(PULSE_COUNT * 3);
    const pulseColors = new Float32Array(PULSE_COUNT * 3);
    const pulseSizes = new Float32Array(PULSE_COUNT);
    const pEdge = new Int32Array(PULSE_COUNT);
    const pT = new Float32Array(PULSE_COUNT);
    const pSpeed = new Float32Array(PULSE_COUNT);
    const pCooldown = new Float32Array(PULSE_COUNT);
    for (let p = 0; p < PULSE_COUNT; p++) {
      pEdge[p] = Math.floor(rand() * edges.length);
      pT[p] = rand();
      pSpeed[p] = 0.14 + rand() * 0.22;
      pCooldown[p] = rand() * 1.5;
      pulseColors[p * 3] = ACCENT_STRONG.r;
      pulseColors[p * 3 + 1] = ACCENT_STRONG.g;
      pulseColors[p * 3 + 2] = ACCENT_STRONG.b;
    }

    // ── Geometries + materials ────────────────────────────────────────────
    const nodeGeom = new THREE.BufferGeometry();
    nodeGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    nodeGeom.setAttribute("aColor", new THREE.BufferAttribute(nodeColors, 3));
    nodeGeom.setAttribute("aSize", new THREE.BufferAttribute(nodeSizes, 1));

    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(linePositions, 3),
    );

    const pulseGeom = new THREE.BufferGeometry();
    const pulsePosAttr = new THREE.BufferAttribute(pulsePositions, 3);
    pulsePosAttr.setUsage(THREE.DynamicDrawUsage);
    const pulseSizeAttr = new THREE.BufferAttribute(pulseSizes, 1);
    pulseSizeAttr.setUsage(THREE.DynamicDrawUsage);
    pulseGeom.setAttribute("position", pulsePosAttr);
    pulseGeom.setAttribute("aColor", new THREE.BufferAttribute(pulseColors, 3));
    pulseGeom.setAttribute("aSize", pulseSizeAttr);

    const pixelRatioUniform = { value: dpr() };

    const nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: pixelRatioUniform,
        uSizeScale: { value: 1 },
        uOpacity: { value: 0.85 * intensity },
      },
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.07 * intensity,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const pulseMat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: pixelRatioUniform,
        uSizeScale: { value: 1.7 },
        uOpacity: { value: 1.0 * intensity },
      },
      vertexShader: NODE_VERT,
      fragmentShader: PULSE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const lines = new THREE.LineSegments(lineGeom, lineMat);
    const nodePoints = new THREE.Points(nodeGeom, nodeMat);
    const pulsePoints = new THREE.Points(pulseGeom, pulseMat);
    for (const o of [lines, nodePoints, pulsePoints]) o.frustumCulled = false;
    lines.renderOrder = 0;
    nodePoints.renderOrder = 1;
    pulsePoints.renderOrder = 2;
    group.add(lines, nodePoints, pulsePoints);

    // ── Pulse stepping ────────────────────────────────────────────────────
    const smooth = (t: number) => t * t * (3 - 2 * t);
    function stepPulses(dt: number) {
      for (let p = 0; p < PULSE_COUNT; p++) {
        if (pCooldown[p] > 0) {
          pCooldown[p] -= dt;
          pulseSizes[p] = 0;
          continue;
        }
        pT[p] += pSpeed[p] * dt;
        if (pT[p] >= 1) {
          pEdge[p] = Math.floor(rand() * edges.length);
          pT[p] = 0;
          pSpeed[p] = 0.14 + rand() * 0.22;
          pCooldown[p] = 0.4 + rand() * 1.8;
          pulseSizes[p] = 0;
          continue;
        }
        const [a, b] = edges[pEdge[p]];
        const e = smooth(pT[p]);
        pulsePositions[p * 3] =
          positions[a * 3] + (positions[b * 3] - positions[a * 3]) * e;
        pulsePositions[p * 3 + 1] =
          positions[a * 3 + 1] +
          (positions[b * 3 + 1] - positions[a * 3 + 1]) * e;
        pulsePositions[p * 3 + 2] =
          positions[a * 3 + 2] +
          (positions[b * 3 + 2] - positions[a * 3 + 2]) * e;
        // Fade in/out along the wire — brightest mid-travel.
        pulseSizes[p] = 1.6 * Math.sin(Math.PI * pT[p]);
      }
      pulsePosAttr.needsUpdate = true;
      pulseSizeAttr.needsUpdate = true;
    }

    // Seed a static, presentable pulse frame (used for reduced-motion + first
    // paint) without any time stepping.
    function seedStaticPulses() {
      for (let p = 0; p < PULSE_COUNT; p++) {
        const [a, b] = edges[pEdge[p]];
        const e = smooth(pT[p]);
        pulsePositions[p * 3] =
          positions[a * 3] + (positions[b * 3] - positions[a * 3]) * e;
        pulsePositions[p * 3 + 1] =
          positions[a * 3 + 1] +
          (positions[b * 3 + 1] - positions[a * 3 + 1]) * e;
        pulsePositions[p * 3 + 2] =
          positions[a * 3 + 2] +
          (positions[b * 3 + 2] - positions[a * 3 + 2]) * e;
        pulseSizes[p] = 1.4 * Math.sin(Math.PI * pT[p]);
      }
      pulsePosAttr.needsUpdate = true;
      pulseSizeAttr.needsUpdate = true;
    }

    // ── Sizing ────────────────────────────────────────────────────────────
    let width = 0;
    let height = 0;
    function resize() {
      const w = container!.clientWidth || 1;
      const h = container!.clientHeight || 1;
      if (w === width && h === height) return;
      width = w;
      height = h;
      const ratio = dpr();
      pixelRatioUniform.value = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (reduceMotion) renderOnce();
    }

    // ── Parallax (damped, desktop only) ──────────────────────────────────
    let targetPX = 0;
    let targetPY = 0;
    let curPX = 0;
    let curPY = 0;
    const MAX_TILT = 0.11; // ~6°
    function onPointerMove(ev: PointerEvent) {
      const r = container!.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const nx = ((ev.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((ev.clientY - r.top) / r.height) * 2 - 1;
      targetPY = nx * MAX_TILT;
      targetPX = ny * MAX_TILT;
    }

    // ── Render ────────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    function applyMotion(t: number) {
      curPX += (targetPX - curPX) * 0.05;
      curPY += (targetPY - curPY) * 0.05;
      group.rotation.x =
        Math.sin(t * 0.05) * 0.1 + Math.sin(t * 0.017) * 0.05 + curPX;
      group.rotation.y =
        Math.sin(t * 0.06) * 0.18 + Math.sin(t * 0.023) * 0.09 + curPY;
      nodeMat.uniforms.uSizeScale.value = 1 + Math.sin(t * 0.5) * 0.05;
    }
    function renderOnce() {
      renderer.render(scene, camera);
    }

    let raf = 0;
    let running = false;
    function loop() {
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      stepPulses(dt);
      applyMotion(t);
      renderOnce();
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

    // ── Boot ──────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => resize());
    ro.observe(container);
    resize();

    if (reduceMotion) {
      // One calm static frame — no loop, honours prefers-reduced-motion.
      seedStaticPulses();
      applyMotion(6.2);
      renderOnce();
    } else {
      seedStaticPulses();
      document.addEventListener("visibilitychange", onVisibility);
      if (finePointer) window.addEventListener("pointermove", onPointerMove);
      if (!document.hidden) start();
    }

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      nodeGeom.dispose();
      lineGeom.dispose();
      pulseGeom.dispose();
      nodeMat.dispose();
      lineMat.dispose();
      pulseMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [density, intensity, interactive]);

  return <div ref={containerRef} aria-hidden className={className} />;
}
