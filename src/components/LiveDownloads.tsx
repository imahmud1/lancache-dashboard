"use client";

import { useEffect, useState } from "react";
import { Activity, Gauge } from "lucide-react";
import { SectionHeader } from "./SectionHeader";
import { formatBytes, formatBits, getServiceLabel, getServiceColor, formatDuration } from "@/lib/format";

interface LiveDownload {
  key: string;
  clientIp: string;
  service: string;
  gameName?: string;
  imageUrl?: string;
  depotId?: string;
  totalBytes: number;
  hitBytes: number;
  missBytes: number;
  requests: number;
  durationSec: number;
  speedBps: number;
}

type SpeedUnit = "bytes" | "bits";

// Splits a rate into a bold value and a smaller suffix for consistent styling.
function formatRate(bytesPerSec: number, unit: SpeedUnit): { value: string; suffix: string } {
  if (unit === "bits") {
    const [value, u] = formatBits(bytesPerSec).split(" ");
    return { value, suffix: ` ${u}` };
  }
  return { value: formatBytes(bytesPerSec), suffix: "/s" };
}

export function LiveDownloads({ includeAll = false }: { includeAll?: boolean }) {
  const [connected, setConnected] = useState(false);
  const [downloads, setDownloads] = useState<LiveDownload[]>([]);
  const [totalBps, setTotalBps] = useState(0);
  const [peakBps, setPeakBps] = useState(0);
  const [unit, setUnit] = useState<SpeedUnit>("bytes");

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const url = includeAll ? "/api/live?includeAll=1" : "/api/live";
      es = new EventSource(url);
      es.onopen = () => setConnected(true);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setDownloads(data.downloads || []);
          setTotalBps(data.totalBps || 0);
          setPeakBps(data.peakBps || 0);
          setConnected(true);
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [includeAll]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <SectionHeader icon={Activity} title="Live Downloads" subtitle="Real-time activity across all services" accent="green">
        {/* Unit toggle */}
        <div className="flex items-center gap-1 p-1 bg-gray-950/50 border border-gray-700/60 rounded-lg">
          <button
            onClick={() => setUnit("bits")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              unit === "bits" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            bit/s
          </button>
          <button
            onClick={() => setUnit("bytes")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              unit === "bytes" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            byte/s
          </button>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
          connected ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          {connected ? "Live" : "Reconnecting"}
        </div>
      </SectionHeader>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl bg-gray-950/50 border border-gray-800 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide mb-1">
            <Gauge className="w-3 h-3" /> Current
          </div>
          <div className="text-lg font-bold text-blue-400">{formatRate(totalBps, unit).value}<span className="text-xs text-gray-500">{formatRate(totalBps, unit).suffix}</span></div>
        </div>
        <div className="rounded-xl bg-gray-950/50 border border-gray-800 p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Peak</div>
          <div className="text-lg font-bold text-purple-400">{formatRate(peakBps, unit).value}<span className="text-xs text-gray-500">{formatRate(peakBps, unit).suffix}</span></div>
        </div>
        <div className="rounded-xl bg-gray-950/50 border border-gray-800 p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Active</div>
          <div className="text-lg font-bold text-gray-100">{downloads.length}<span className="text-xs text-gray-500"> downloads</span></div>
        </div>
      </div>

      {downloads.length === 0 ? (
        <div className="text-center py-10">
          <div className="w-12 h-12 rounded-2xl bg-gray-800/50 flex items-center justify-center mx-auto mb-3">
            <Activity className="w-5 h-5 text-gray-600" />
          </div>
          <p className="text-sm text-gray-400">No active downloads</p>
          <p className="text-xs text-gray-600 mt-1">Live activity appears here as clients download.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {downloads.map((d) => (
            <DownloadRow key={d.key} d={d} maxBps={downloads[0]?.speedBps || 1} unit={unit} />
          ))}
        </div>
      )}
    </div>
  );
}

function DownloadRow({ d, maxBps, unit }: { d: LiveDownload; maxBps: number; unit: SpeedUnit }) {
  const dotColor = getServiceColor(d.service);
  const speedPct = (d.speedBps / maxBps) * 100;
  const title = d.gameName || (d.service === "steam" && d.depotId ? `Steam depot ${d.depotId}` : getServiceLabel(d.service));
  const cacheable = d.hitBytes + d.missBytes;
  const hitPct = cacheable > 0 ? Math.round((d.hitBytes / cacheable) * 100) : 0;

  return (
    <div className="relative rounded-xl bg-gray-800/40 border border-gray-800 hover:border-gray-700 overflow-hidden transition-colors">
      <div className="absolute inset-y-0 left-0 bg-blue-500/5" style={{ width: `${speedPct}%` }} />
      <div className="relative flex items-center gap-3 p-3">
        {/* Thumbnail */}
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-800 shrink-0 border border-gray-700/40">
          {d.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-100 truncate">{title}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
            <span className="font-medium text-gray-400">{getServiceLabel(d.service)}</span>
            <span className="font-mono">{d.clientIp}</span>
            <span>· {formatBytes(d.totalBytes)} in {formatDuration(d.durationSec)}</span>
            {cacheable > 0 && (
              <span className={hitPct >= 50 ? "text-green-400" : "text-amber-400"}>· {hitPct}% cached</span>
            )}
          </div>
        </div>

        {/* Speed */}
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-blue-400 font-mono">{formatRate(d.speedBps, unit).value}<span className="text-gray-500">{formatRate(d.speedBps, unit).suffix}</span></div>
        </div>
      </div>
    </div>
  );
}
