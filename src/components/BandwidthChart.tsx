"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { Panel, Empty, pct } from "./ui";

interface BandwidthDatum {
  bucket: string; // "2026-07-01" (day) or "2026-07-01T18" (hour)
  bytesSent: number;
  hitBytes: number;
  missBytes: number;
}

// Chart colours mirror the cache / internet / neutral tokens in globals.css.
const CACHE = "#3ddc84";
const INTERNET = "#f5a524";
const LINE = "#222c3c";
const INK3 = "#8090a6";

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Round byte ticks (0 / 250 GB / 500 GB …) in the unit that suits the peak. */
export function niceByteTicks(max: number, count = 4): { ticks: number[]; unit: number; label: string } {
  if (max <= 0) return { ticks: [0], unit: 1, label: "B" };
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(max) / Math.log(1024)));
  const unit = 1024 ** i;
  const raw = max / unit / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max / unit + step * 0.001; v += step) ticks.push(v * unit);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks.length * step * unit);
  return { ticks, unit, label: UNITS[i] };
}

function tickLabel(v: number, unit: number, label: string): string {
  if (v === 0) return "0";
  const n = v / unit;
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${label}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bucketTime(b: string): number {
  return Date.parse(b.length > 10 ? `${b}:00:00Z` : `${b}T00:00:00Z`);
}

function bucketLabel(b: string, hourly: boolean): string {
  const [, m, d] = b.slice(0, 10).split("-").map(Number);
  const day = `${d} ${MONTHS[m - 1]}`;
  return hourly ? `${day} ${b.slice(11)}:00` : day;
}

interface Row {
  label: string;
  fromCache: number;
  fromUpstream: number;
  gap?: string;
}

/**
 * Bars, not a smoothed area: each bucket is a real measurement, and a curve
 * would invent values between days. Non-consecutive buckets get an explicit
 * gap marker so a hole in the data reads as a hole, not a dip.
 */
function toRows(data: BandwidthDatum[], granularity: "hour" | "3h" | "day"): Row[] {
  const hourly = granularity !== "day";
  const stepMs = granularity === "hour" ? 3_600_000 : granularity === "3h" ? 3 * 3_600_000 : 86_400_000;
  const rows: Row[] = [];
  data.forEach((d, i) => {
    if (i > 0) {
      const missing = Math.round((bucketTime(d.bucket) - bucketTime(data[i - 1].bucket)) / stepMs) - 1;
      if (missing > 0) {
        const unit = granularity === "day" ? "day" : granularity === "3h" ? "×3h" : "hour";
        rows.push({ label: `${missing} ${unit}${missing === 1 || unit === "×3h" ? "" : "s"} without data`, fromCache: 0, fromUpstream: 0, gap: `gap-${i}` });
      }
    }
    rows.push({ label: bucketLabel(d.bucket, hourly), fromCache: d.hitBytes, fromUpstream: d.missBytes });
  });
  return rows;
}

export function BandwidthChart({
  data,
  granularity = "day",
  className = "",
}: {
  data: BandwidthDatum[];
  granularity?: "hour" | "3h" | "day";
  className?: string;
}) {
  const rows = toRows(data, granularity);
  const totalCache = data.reduce((s, d) => s + d.hitBytes, 0);
  const totalUpstream = data.reduce((s, d) => s + d.missBytes, 0);
  const step = granularity === "hour" ? "Hourly" : granularity === "3h" ? "Every 3 hours" : "Daily";
  const unitWord = granularity === "day" ? "day" : granularity === "3h" ? "3 hours" : "hour";
  const peakRow = data.reduce<BandwidthDatum | null>((best, d) => (!best || d.hitBytes + d.missBytes > best.hitBytes + best.missBytes ? d : best), null);
  const peak = peakRow ? peakRow.hitBytes + peakRow.missBytes : 0;
  const avg = data.length ? (totalCache + totalUpstream) / data.length : 0;
  const axis = niceByteTicks(peak);
  const share = pct(totalCache, totalCache + totalUpstream);

  return (
    <Panel
      title="Bandwidth"
      icon={TrendingUp}
      meta={`${step} · UTC · ${data.length} ${data.length === 1 ? unitWord : `${unitWord}s`} with traffic`}
      className={className}
      bodyClassName="px-5 pb-5"
    >
      {rows.length === 0 ? (
        <Empty icon={TrendingUp} title="No traffic in this range" hint="Pick a wider time range, or wait for the next ingest." />
      ) : (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-3 pb-5 mb-4 border-b border-line">
            <Fig label="From cache" value={formatBytes(totalCache)} tone="text-cache" swatch="bg-cache" />
            <Fig label="From internet" value={formatBytes(totalUpstream)} tone="text-internet" swatch="bg-internet" />
            <Fig label={`Peak ${unitWord}`} value={formatBytes(peak)} sub={peakRow ? bucketLabel(peakRow.bucket, granularity !== "day") : undefined} />
            <Fig label={`Average per ${unitWord}`} value={formatBytes(avg)} sub={`${share.toFixed(1)}% from cache overall`} />
          </dl>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid stroke={LINE} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: INK3, fontSize: 11 }}
                  axisLine={{ stroke: LINE }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={28}
                  tickFormatter={(v: string) => (v.includes("without data") ? "…" : v)}
                />
                <YAxis
                  tick={{ fill: INK3, fontSize: 11 }}
                  ticks={axis.ticks}
                  domain={[0, axis.ticks[axis.ticks.length - 1]]}
                  tickFormatter={(v) => tickLabel(Number(v), axis.unit, axis.label)}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<ChartTip />} />
                <Bar dataKey="fromCache" stackId="b" fill={CACHE} isAnimationActive animationDuration={700} />
                <Bar dataKey="fromUpstream" stackId="b" fill={INTERNET} radius={[3, 3, 0, 0]} isAnimationActive animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { payload: Row }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  if (r.gap) {
    return <div className="rounded-lg border border-line-strong bg-raised px-3 py-2 text-xs text-ink-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">{label}</div>;
  }
  const total = r.fromCache + r.fromUpstream;
  return (
    <div className="rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-xs shadow-[0_8px_24px_rgba(0,0,0,0.45)] min-w-44">
      <div className="text-ink-2 mb-1.5">{label}</div>
      <div className="flex justify-between gap-6"><span className="text-cache">From cache</span><span className="figure text-ink font-semibold">{formatBytes(r.fromCache)}</span></div>
      <div className="flex justify-between gap-6 mt-0.5"><span className="text-internet">From internet</span><span className="figure text-ink font-semibold">{formatBytes(r.fromUpstream)}</span></div>
      <div className="flex justify-between gap-6 mt-1.5 pt-1.5 border-t border-line"><span className="text-ink-3">Total · {Math.round(pct(r.fromCache, total))}% cache</span><span className="figure text-ink font-semibold">{formatBytes(total)}</span></div>
    </div>
  );
}

function Fig({ label, value, tone = "text-ink", swatch, sub }: { label: string; value: string; tone?: string; swatch?: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-ink-3">
        {swatch && <span className={`w-2 h-2 rounded-sm ${swatch}`} aria-hidden />}
        {label}
      </dt>
      <dd className={`figure text-2xl font-semibold leading-none mt-1.5 ${tone}`}>{value}</dd>
      {sub && <dd className="text-[11px] text-ink-3 mt-1.5 truncate">{sub}</dd>}
    </div>
  );
}
