"use client";

import { useEffect, useRef } from "react";
import { formatBytes } from "@/lib/format";

export interface LivePoint {
  t: number;
  hitBps: number;
  missBps: number;
}

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** Hex/rgb colour → rgba() string with alpha, for canvas gradients. */
function withAlpha(color: string, a: number): string {
  const c = color.trim();
  if (c.startsWith("#")) {
    const h = c.length === 4 ? c.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : c;
    const n = parseInt(h.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  return c;
}

/**
 * Stacked live throughput (cache under internet) that scrolls continuously.
 * Drawn on a canvas in a rAF loop, lagged one second so each new sample slides
 * in from the right edge instead of popping. The y-scale eases toward its
 * target so a burst doesn't make the chart jump.
 */
export function LiveChart({
  points,
  windowSec = 300,
  className = "",
  labelPx = 11,
  grid = 3,
  ariaLabel = "Live throughput, cache vs internet",
}: {
  points: LivePoint[];
  windowSec?: number;
  className?: string;
  labelPx?: number;
  grid?: number;
  ariaLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef(points);
  const scaleRef = useRef(1);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let lastDraw = 0;
    const cache = cssVar(canvas, "--color-cache", "#3ddc84");
    const internet = cssVar(canvas, "--color-internet", "#f5a524");
    const line = cssVar(canvas, "--color-line", "#222c3c");
    const ink3 = cssVar(canvas, "--color-ink-3", "#8090a6");
    const font = getComputedStyle(canvas).getPropertyValue("--font-display").trim() || "sans-serif";

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      // ~30fps is plenty for a 5-minute window; reduced motion redraws once a second.
      if (ts - lastDraw < (reduce ? 1000 : 33)) return;
      lastDraw = ts;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const pts = pointsRef.current;
      const now = Date.now() - 1000;
      const t0 = now - windowSec * 1000;
      const x = (t: number) => ((t - t0) / (windowSec * 1000)) * w;
      const visible = pts.filter((p) => p.t >= t0 - 2000);

      const target = Math.max(1, ...visible.map((p) => p.hitBps + p.missBps)) * 1.18;
      scaleRef.current += (target - scaleRef.current) * (reduce ? 1 : 0.08);
      const max = scaleRef.current;
      const top = labelPx + 6;
      const y = (v: number) => h - (v / max) * (h - top);

      // Grid + labels (no scale while idle: "0.4 B/s" ticks are noise)
      ctx.font = `600 ${labelPx}px ${font}`;
      ctx.textBaseline = "bottom";
      const idle = target <= 1.18 * 1024;
      for (let i = 1; i <= grid && !idle; i++) {
        const v = (max / (grid + 0.18)) * i;
        const gy = Math.round(y(v)) + 0.5;
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
        ctx.fillStyle = ink3;
        ctx.fillText(`${formatBytes(v)}/s`, 4, gy - 3);
      }

      if (visible.length < 2) return;

      const area = (vals: (p: LivePoint) => number, color: string) => {
        const grad = ctx.createLinearGradient(0, top, 0, h);
        grad.addColorStop(0, withAlpha(color, 0.42));
        grad.addColorStop(1, withAlpha(color, 0.04));
        ctx.beginPath();
        ctx.moveTo(x(visible[0].t), h);
        for (const p of visible) ctx.lineTo(x(p.t), y(vals(p)));
        ctx.lineTo(x(visible[visible.length - 1].t), h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        visible.forEach((p, i) => (i === 0 ? ctx.moveTo(x(p.t), y(vals(p))) : ctx.lineTo(x(p.t), y(vals(p)))));
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.stroke();
      };

      area((p) => p.hitBps + p.missBps, internet); // total, so internet shows as the band above cache
      area((p) => p.hitBps, cache);

      // Leading edge: a dot riding the latest total
      const last = visible[visible.length - 1];
      const lx = Math.min(w - 3, x(last.t));
      ctx.beginPath();
      ctx.arc(lx, y(last.hitBps + last.missBps), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = internet;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, y(last.hitBps), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = cache;
      ctx.fill();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [windowSec, labelPx, grid]);

  return <canvas ref={canvasRef} className={`block w-full ${className}`} role="img" aria-label={ariaLabel} />;
}
