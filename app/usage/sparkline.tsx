interface Point {
  date: string;
  value: number;
}

/**
 * Tiny in-house sparkline. Renders a smoothed area under a tinted stroke,
 * plus a subtle baseline grid. Animates the path drawing on mount via
 * pure CSS — no JS, no Framer needed for this primitive.
 */
export function Sparkline({
  data,
  width = 800,
  height = 96,
  stroke = "var(--accent)",
}: {
  data: Point[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-[12px] text-fg-subtle">
        No data yet.
      </div>
    );
  }

  const padY = 6;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((d, i) => {
    const x = i * step;
    const y = height - padY - (d.value / max) * (height - padY * 2);
    return { x, y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height} L0,${height} Z`;

  const peakIdx = points.reduce(
    (best, p, i) => (p.y < points[best].y ? i : best),
    0,
  );
  const peak = points[peakIdx];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Daily spend over the last 30 days"
      className="w-full block"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="sparkArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* baseline */}
      <line
        x1="0"
        x2={width}
        y1={height - padY}
        y2={height - padY}
        stroke="var(--border-hairline)"
        strokeDasharray="2 4"
      />
      <path d={areaPath} fill="url(#sparkArea)" />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* peak marker — orient eye toward the high point */}
      <circle
        cx={peak.x}
        cy={peak.y}
        r={3}
        fill="var(--bg)"
        stroke={stroke}
        strokeWidth={1.5}
      />
    </svg>
  );
}
