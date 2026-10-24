"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Layers, ChevronDown } from "lucide-react";
import { formatBytes, formatNumber, getServiceLabel, getServiceColor } from "@/lib/format";
import { Panel, Segmented, SplitBar, Empty, hitTone, pct } from "./ui";

interface ServiceData {
  service: string;
  bytesSent: number;
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  hitBytes: number;
  missBytes: number;
}

type Service = ServiceData & { color: string; share: number; hitRate: number };

const CARD_LIMIT = 9;

export function ServiceChart({ data }: { data: ServiceData[] }) {
  const [view, setView] = useState<"cards" | "chart">("cards");
  const [showAll, setShowAll] = useState(false);

  const totalBytes = data.reduce((s, d) => s + d.bytesSent, 0);
  const totalRequests = data.reduce((s, d) => s + d.requests, 0);

  const services: Service[] = data
    .map((d) => ({
      ...d,
      color: getServiceColor(d.service),
      share: pct(d.bytesSent, totalBytes),
      hitRate: Math.round(pct(d.hitBytes, d.hitBytes + d.missBytes)),
    }))
    .sort((a, b) => b.bytesSent - a.bytesSent);

  return (
    <Panel
      title="Services"
      icon={Layers}
      meta={`${services.length} platforms · ${formatBytes(totalBytes)} served`}
      actions={
        <Segmented
          label="Services view"
          value={view}
          onChange={setView}
          options={[
            { value: "cards", label: "Cards" },
            { value: "chart", label: "Chart" },
          ]}
        />
      }
    >
      {services.length === 0 ? (
        <Empty icon={Layers} title="No service data yet" hint="Run an ingest to populate this view." />
      ) : (
        <>
          {/* Share of all traffic, always visible: one bar, one segment per service */}
          <div className="flex h-2 rounded-full overflow-hidden bg-raised mb-5 gap-px" role="img" aria-label="Share of traffic by service">
            {services.map((s) => (
              <div key={s.service} style={{ width: `${s.share}%`, backgroundColor: s.color }} title={`${getServiceLabel(s.service)} · ${s.share.toFixed(1)}%`} />
            ))}
          </div>
          {view === "cards" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-px rounded-lg overflow-hidden border border-line bg-line">
                {(showAll ? services : services.slice(0, CARD_LIMIT)).map((s) => (
                  <ServiceCell key={s.service} s={s} />
                ))}
              </div>
              {services.length > CARD_LIMIT && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  aria-expanded={showAll}
                  className="flex items-center gap-2 mx-auto mt-4 h-9 px-4 text-[13px] font-medium text-ink-2 bg-panel border border-line rounded-lg hover:text-ink hover:border-line-strong transition-colors"
                >
                  {showAll ? "Show top services" : `Show all ${services.length} services`}
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden />
                </button>
              )}
            </>
          ) : (
            <ChartView services={services} totalBytes={totalBytes} totalRequests={totalRequests} />
          )}
        </>
      )}
    </Panel>
  );
}

function ServiceCell({ s }: { s: Service }) {
  const tone = hitTone(s.hitRate);
  return (
    <div className="bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} aria-hidden />
          <span className="text-sm font-semibold text-ink truncate">{getServiceLabel(s.service)}</span>
        </div>
        <span className="figure text-xs text-ink-3 shrink-0">{s.share.toFixed(1)}% of traffic</span>
      </div>

      <div className="flex items-baseline justify-between mt-3">
        <span className="figure text-2xl font-semibold text-ink leading-none">{formatBytes(s.bytesSent)}</span>
        <span className={`figure text-sm font-semibold ${tone.text}`}>{s.hitRate}% cache</span>
      </div>

      <SplitBar hit={s.hitBytes} miss={s.missBytes} className="h-1.5 mt-2.5" />

      <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
        <div>
          <div className="text-ink-3">From cache</div>
          <div className="figure font-semibold text-cache mt-0.5">{formatBytes(s.hitBytes)}</div>
        </div>
        <div>
          <div className="text-ink-3">From internet</div>
          <div className="figure font-semibold text-internet mt-0.5">{formatBytes(s.missBytes)}</div>
        </div>
        <div className="text-right">
          <div className="text-ink-3">Requests</div>
          <div className="figure font-semibold text-ink-2 mt-0.5">{formatNumber(s.requests)}</div>
        </div>
      </div>
    </div>
  );
}

function ChartView({ services, totalBytes, totalRequests }: { services: Service[]; totalBytes: number; totalRequests: number }) {
  const totalHit = services.reduce((s, d) => s + d.hitBytes, 0);
  const totalMiss = services.reduce((s, d) => s + d.missBytes, 0);
  const overallHit = Math.round(pct(totalHit, totalHit + totalMiss));

  return (
    <div className="flex flex-col md:flex-row md:items-center gap-8">
      <div className="shrink-0 flex flex-col items-center gap-3 mx-auto md:mx-0">
        <div className="relative w-48 h-48">
          <div className="absolute inset-0 z-0 flex flex-col items-center justify-center pointer-events-none">
            <span className={`figure text-3xl font-semibold leading-none ${hitTone(overallHit).text}`}>{overallHit}%</span>
            <span className="text-xs text-ink-3 mt-1">from cache</span>
          </div>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <PieChart>
              <Pie data={services} cx="50%" cy="50%" innerRadius={60} outerRadius={86} dataKey="bytesSent" nameKey="service" stroke="#0d1117" strokeWidth={2}>
                {services.map((entry) => (
                  <Cell key={entry.service} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                wrapperStyle={{ zIndex: 50 }}
                contentStyle={{ backgroundColor: "#151b23", border: "1px solid #2d3644", borderRadius: 8, fontSize: 12 }}
                itemStyle={{ color: "#e6e8eb" }}
                formatter={(value, name) => [formatBytes(Number(value)), getServiceLabel(String(name))]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="figure text-xs text-ink-3">
          {formatBytes(totalBytes)} served · {formatNumber(totalRequests)} requests
        </div>
      </div>

      <ul className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-x-8">
        {services.map((s) => (
          <li key={s.service} className="flex items-center gap-2.5 py-2 border-b border-line">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="text-sm text-ink-2 flex-1 truncate">{getServiceLabel(s.service)}</span>
            <span className={`figure text-xs font-semibold ${hitTone(s.hitRate).text}`}>{s.hitRate}%</span>
            <span className="figure text-sm font-semibold text-ink w-20 text-right">{formatBytes(s.bytesSent)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
