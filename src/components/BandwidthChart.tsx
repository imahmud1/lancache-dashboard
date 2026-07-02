"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { SectionHeader } from "./SectionHeader";

interface BandwidthDatum {
  bucket: string; // "2026-07-01" (day) or "2026-07-01T18" (hour)
  bytesSent: number;
  hitBytes: number;
  missBytes: number;
}

export function BandwidthChart({ data, granularity = "day" }: { data: BandwidthDatum[]; granularity?: "hour" | "3h" | "day" }) {
  const hourly = granularity === "hour" || granularity === "3h";
  const chartData = data.map((d) => ({
    label: hourly ? `${d.bucket.slice(11)}:00` : d.bucket.slice(5),
    fromCache: d.hitBytes,
    fromUpstream: d.missBytes,
    total: d.bytesSent,
  }));

  const totalCache = data.reduce((s, d) => s + d.hitBytes, 0);
  const totalUpstream = data.reduce((s, d) => s + d.missBytes, 0);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 h-full">
      <SectionHeader
        icon={TrendingUp}
        title="Bandwidth"
        subtitle={granularity === "hour" ? "Hourly (UTC) · cache vs internet" : granularity === "3h" ? "Every 3h (UTC) · cache vs internet" : "Daily (UTC) · cache vs internet"}
        accent="blue"
      >
        <div className="flex items-center gap-3">
          <Legend color="#22c55e" label="Cache" value={formatBytes(totalCache)} />
          <Legend color="#f59e0b" label="Internet" value={formatBytes(totalUpstream)} />
        </div>
      </SectionHeader>

      <div className="h-64 min-h-[1px]">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <AreaChart data={chartData} margin={{ top: 5, right: 8, left: 8, bottom: 5 }}>
            <defs>
              <linearGradient id="cacheGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="upstreamGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={(v) => formatBytes(v)} axisLine={false} tickLine={false} width={55} />
            <Tooltip
              contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "10px", fontSize: "12px" }}
              labelStyle={{ color: "#9ca3af" }}
              formatter={(value, name) => [formatBytes(Number(value)), name === "fromCache" ? "From Cache" : "From Internet"]}
            />
            <Area type="monotone" dataKey="fromCache" stackId="1" stroke="#22c55e" fill="url(#cacheGrad)" strokeWidth={2} />
            <Area type="monotone" dataKey="fromUpstream" stackId="1" stroke="#f59e0b" fill="url(#upstreamGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-[11px] font-semibold text-gray-200">{value}</span>
    </div>
  );
}
