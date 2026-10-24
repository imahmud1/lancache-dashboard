"use client";

import { useEffect, useState } from "react";

// Two concentric readings of the same truth:
//   inner (thick)  served from cache vs internet over the selected range
//   outer (thin)   the same split for the traffic flowing right now
// The outer ring re-splits every second; the inner one holds the totals.

const SIZE = 200;
const C = SIZE / 2;
const R_INNER = 74;
const W_INNER = 20;
const R_OUTER = 93;
const W_OUTER = 5;
const GAP_DEG = 1.4; // hairline gap where the two colours meet

function arc(r: number, fraction: number) {
  const circ = 2 * Math.PI * r;
  return { circ, len: Math.max(0, Math.min(1, fraction)) * circ };
}

function Split({
  r,
  w,
  fraction,
  active,
  settled,
  track = "var(--color-raised)",
}: {
  r: number;
  w: number;
  fraction: number | null;
  active: boolean;
  settled: boolean;
  track?: string;
}) {
  const { circ } = arc(r, 1);
  const gap = (GAP_DEG / 360) * circ;
  const f = fraction ?? 0;
  const cacheLen = settled ? Math.max(0, f * circ - (f > 0 && f < 1 ? gap : 0)) : 0;
  const netStart = f * circ;
  const netLen = settled ? Math.max(0, (1 - f) * circ - (f > 0 && f < 1 ? gap : 0)) : 0;
  const ease = "stroke-dasharray 900ms cubic-bezier(0.16, 1, 0.3, 1), stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)";

  return (
    <g transform={`rotate(-90 ${C} ${C})`}>
      <circle cx={C} cy={C} r={r} fill="none" stroke={track} strokeWidth={w} />
      {active && fraction !== null && (
        <>
          <circle
            cx={C}
            cy={C}
            r={r}
            fill="none"
            stroke="var(--color-internet)"
            strokeOpacity={0.85}
            strokeWidth={w}
            strokeDasharray={`${netLen} ${circ}`}
            strokeDashoffset={-netStart}
            style={{ transition: ease }}
          />
          <circle
            cx={C}
            cy={C}
            r={r}
            fill="none"
            stroke="var(--color-cache)"
            strokeWidth={w}
            strokeDasharray={`${cacheLen} ${circ}`}
            style={{ transition: ease }}
          />
        </>
      )}
    </g>
  );
}

export function MeterRing({
  totalFraction,
  liveFraction,
  children,
  className = "",
}: {
  /** Share of cacheable bytes served from cache in the range, 0..1, or null when there's no traffic. */
  totalFraction: number | null;
  /** Share of current throughput served from cache, 0..1, or null when idle. */
  liveFraction: number | null;
  children?: React.ReactNode;
  className?: string;
}) {
  // Draw from empty once on mount: the one authored entrance on the stage.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`relative aspect-square ${className}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 w-full h-full" aria-hidden>
        {/* Idle live track stays visible so the two-ring structure reads even between bursts */}
        <Split r={R_OUTER} w={W_OUTER} fraction={liveFraction} active={liveFraction !== null} settled={settled} track="var(--color-line-strong)" />
        <Split r={R_INNER} w={W_INNER} fraction={totalFraction} active={totalFraction !== null} settled={settled} />
        {/* Graduated scale between the rings: quarter marks make it an instrument, not a donut */}
        {[0, 0.25, 0.5, 0.75].map((q) => {
          const a = q * 2 * Math.PI - Math.PI / 2;
          const r1 = R_INNER + W_INNER / 2 + 2.5;
          const r2 = R_OUTER - W_OUTER / 2 - 1.5;
          return (
            <line
              key={q}
              x1={C + r1 * Math.cos(a)}
              y1={C + r1 * Math.sin(a)}
              x2={C + r2 * Math.cos(a)}
              y2={C + r2 * Math.sin(a)}
              stroke="var(--color-ink-3)"
              strokeWidth={1.2}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
