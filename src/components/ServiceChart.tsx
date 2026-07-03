"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Layers, LayoutGrid, ChartPie } from "lucide-react";
import { formatBytes, formatNumber, getServiceLabel, getServiceColor } from "@/lib/format";
import { SectionHeader } from "./SectionHeader";

interface ServiceData {
  service: string;
  bytesSent: number;
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  hitBytes: number;
  missBytes: number;
}

export function ServiceChart({ data }: { data: ServiceData[] }) {
  const [view, setView] = useState<"grid" | "chart">("grid");

  const totalBytes = data.reduce((s, d) => s + d.bytesSent, 0);
  const totalRequests = data.reduce((s, d) => s + d.requests, 0);

  const services = data
    .map((d) => {
      const cacheable = d.hitBytes + d.missBytes;
      return {
        ...d,
        color: getServiceColor(d.service),
        pct: totalBytes > 0 ? (d.bytesSent / totalBytes) * 100 : 0,
        hitRate: cacheable > 0 ? Math.round((d.hitBytes / cacheable) * 100) : 0,
      };
    })
    .sort((a, b) => b.bytesSent - a.bytesSent);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <SectionHeader icon={Layers} title="Services" subtitle={`${services.length} platforms · ${formatBytes(totalBytes)} served`} accent="amber">
        {/* View toggle */}
        <div className="flex items-center gap-1 p-1 bg-gray-950/50 border border-gray-700/60 rounded-lg">
          <button
            onClick={() => setView("grid")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              view === "grid" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            <LayoutGrid className="w-3 h-3" /> Cards
          </button>
          <button
            onClick={() => setView("chart")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              view === "chart" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            <ChartPie className="w-3 h-3" /> Chart
          </button>
        </div>
      </SectionHeader>

      {services.length === 0 ? (
        <p className="text-center text-gray-500 text-sm py-10">No service data yet.</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {services.map((s) => (
            <ServiceTile key={s.service} s={s} />
          ))}
        </div>
      ) : (
        <ChartView services={services} totalBytes={totalBytes} totalRequests={totalRequests} />
      )}
    </div>
  );
}

function ServiceTile({ s }: { s: { service: string; bytesSent: number; requests: number; cacheHits: number; cacheMisses: number; hitBytes: number; missBytes: number; color: string; pct: number; hitRate: number } }) {
  const hitColor = s.hitRate >= 50 ? "text-green-400" : s.hitRate > 0 ? "text-amber-400" : "text-gray-500";
  const hitBar = s.hitRate >= 50 ? "bg-green-500" : s.hitRate > 0 ? "bg-amber-500" : "bg-gray-600";

  return (
    <div className="rounded-xl bg-gray-800/40 border border-gray-800 hover:border-gray-700 p-4 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-md" style={{ backgroundColor: s.color }} />
          <span className="text-sm font-semibold text-gray-100">{getServiceLabel(s.service)}</span>
        </div>
        <span className="text-[11px] font-semibold text-gray-400 px-2 py-0.5 rounded-md bg-gray-900/60">
          {s.pct.toFixed(1)}%
        </span>
      </div>

      {/* Share bar */}
      <div className="h-1.5 rounded-full bg-gray-700/60 overflow-hidden mb-3">
        <div className="h-full rounded-full" style={{ width: `${Math.max(s.pct, 1.5)}%`, backgroundColor: s.color }} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total</p>
          <p className="text-sm font-bold text-blue-400">{formatBytes(s.bytesSent)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Requests</p>
          <p className="text-sm font-semibold text-gray-200">{formatNumber(s.requests)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">From Cache</p>
          <p className="text-sm font-semibold text-green-400">{formatBytes(s.hitBytes)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">From Net</p>
          <p className="text-sm font-semibold text-amber-400">{formatBytes(s.missBytes)}</p>
        </div>
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Cache Hit Rate</p>
            <span className={`text-[11px] font-bold ${hitColor}`}>{s.hitRate}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-700/60 overflow-hidden">
            <div className={`h-full rounded-full ${hitBar}`} style={{ width: `${Math.max(s.hitRate, 1.5)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartView({
  services,
  totalBytes,
  totalRequests,
}: {
  services: { service: string; bytesSent: number; color: string; pct: number }[];
  totalBytes: number;
  totalRequests: number;
}) {
  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <div className="relative w-44 h-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <PieChart>
            <Pie data={services} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="bytesSent" nameKey="service" stroke="none" paddingAngle={2}>
              {services.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "10px", fontSize: "12px" }}
              labelStyle={{ color: "#9ca3af" }}
              formatter={(value, name) => [formatBytes(Number(value)), getServiceLabel(String(name))]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">Total</span>
          <span className="text-base font-bold text-gray-100">{formatBytes(totalBytes)}</span>
          <span className="text-[10px] text-gray-500">{formatNumber(totalRequests)} req</span>
        </div>
      </div>

      <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {services.map((s) => (
          <div key={s.service} className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-xs text-gray-300 flex-1 truncate">{getServiceLabel(s.service)}</span>
            <span className="text-[11px] text-gray-500">{s.pct.toFixed(1)}%</span>
            <span className="text-xs font-medium text-gray-400 w-16 text-right">{formatBytes(s.bytesSent)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
