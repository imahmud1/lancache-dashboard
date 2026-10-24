"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Tween a number toward its latest value (count-up on first load, glide on
 * updates). Respects prefers-reduced-motion by jumping straight to the value.
 */
export function useAnimatedNumber(value: number, duration = 900): number {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (reduce || a === b) {
      from.current = b;
      setShown(b);
      return;
    }
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4); // ease-out quart
      const v = a + (b - a) * eased;
      from.current = v;
      setShown(v);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  return shown;
}

/** Hit-rate tone: the one place thresholds live, so every section agrees. */
export function hitTone(rate: number): { text: string; bar: string } {
  if (rate >= 50) return { text: "text-cache", bar: "bg-cache" };
  if (rate > 0) return { text: "text-internet", bar: "bg-internet" };
  return { text: "text-ink-3", bar: "bg-line-strong" };
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** The standard section container: hairline border, flat panel, consistent header. */
export function Panel({
  title,
  icon: Icon,
  meta,
  actions,
  children,
  className = "",
  bodyClassName = "px-5 pb-5",
  as: Tag = "section",
}: {
  title: string;
  icon?: LucideIcon;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag className={`min-w-0 rounded-xl border border-line bg-panel ${className}`} aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <span className="w-8 h-8 rounded-lg bg-accent/12 text-accent flex items-center justify-center shrink-0" aria-hidden>
              <Icon className="w-4 h-4" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink tracking-[-0.01em] leading-tight">{title}</h2>
            {meta && <div className="text-xs text-ink-3 truncate mt-0.5">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </Tag>
  );
}

/** Two-way split of cacheable bytes: served from cache vs fetched from the internet. */
export function SplitBar({ hit, miss, className = "h-1.5" }: { hit: number; miss: number; className?: string }) {
  const total = hit + miss;
  const h = pct(hit, total);
  return (
    <div
      className={`flex overflow-hidden rounded-full bg-raised ${className}`}
      role="img"
      aria-label={total > 0 ? `${Math.round(h)}% from cache` : "No cacheable traffic"}
    >
      {total > 0 && (
        <>
          <div className="h-full bg-cache transition-[width] duration-500 ease-out" style={{ width: `${h}%` }} />
          <div className="h-full bg-internet/80 transition-[width] duration-500 ease-out" style={{ width: `${100 - h}%` }} />
        </>
      )}
    </div>
  );
}

/** Compact hit-rate readout: mini bar + percentage, toned by threshold. */
export function HitRate({ rate, className = "" }: { rate: number; className?: string }) {
  const tone = hitTone(rate);
  return (
    <div className={`flex items-center justify-end gap-2 ${className}`} title={`${rate}% of cacheable bytes served from cache`}>
      <div className="w-10 h-1 rounded-full bg-raised overflow-hidden" aria-hidden>
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(rate, 3)}%` }} />
      </div>
      <span className={`figure text-[13px] font-semibold w-9 text-right ${tone.text}`}>{rate}%</span>
    </div>
  );
}

/** Segmented control. Options are short labels; the active one is raised. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-ground/60 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
              active ? "bg-raised text-ink shadow-[0_1px_2px_rgba(0,0,0,0.4)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            {o.label}
            {o.count !== undefined && <span className={`figure text-[11px] ${active ? "text-ink-2" : "text-ink-3"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Header-bar button. `tone` marks a toggled/active state. */
export function ToolButton({
  children,
  onClick,
  title,
  active = false,
  tone = "accent",
  className = "",
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  tone?: "accent" | "internet" | "cache";
  className?: string;
  "aria-expanded"?: boolean;
  "aria-pressed"?: boolean;
  "aria-label"?: string;
}) {
  const activeCls = {
    accent: "border-accent/40 bg-accent/10 text-ink",
    internet: "border-internet/40 bg-internet/10 text-internet",
    cache: "border-cache/40 bg-cache/10 text-cache",
  }[tone];
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-[13px] font-medium transition-colors ${
        active ? activeCls : "border-line bg-panel text-ink-2 hover:text-ink hover:border-line-strong"
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Empty state: one line of what's missing, one of what fills it. */
export function Empty({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10">
      <Icon className="w-5 h-5 text-ink-3 mb-3" aria-hidden />
      <p className="text-sm text-ink-2">{title}</p>
      {hint && <p className="text-xs text-ink-3 mt-1">{hint}</p>}
    </div>
  );
}
