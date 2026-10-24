"use client";

import { History } from "lucide-react";
import { formatBytes, getServiceLabel, getServiceColor } from "@/lib/format";
import { Panel, Empty } from "./ui";

interface RecentEntry {
  id: number;
  timestamp: string;
  service: string;
  clientIp: string;
  requestPath: string;
  bytesSent: number;
  cacheStatus: string;
  upstreamHost: string;
  hostname?: string | null;
}

export function RecentActivity({ entries, className = "" }: { entries: RecentEntry[]; className?: string }) {
  return (
    <Panel title="Recent downloads" icon={History} meta="Latest requests from the last ingest" className={className} bodyClassName="pb-3">
      {entries.length === 0 ? (
        <Empty icon={History} title="No recent activity" hint="Requests appear here after the next ingest." />
      ) : (
        <ul className="max-h-[26rem] overflow-y-auto px-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="grid grid-cols-[3rem_6.5rem_minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 px-2 py-1.5 rounded-md hover:bg-raised/60 transition-colors group"
            >
              <Status status={entry.cacheStatus} />
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getServiceColor(entry.service) }} aria-hidden />
                <span className="text-xs text-ink-2 truncate">{getServiceLabel(entry.service)}</span>
              </span>
              {entry.hostname ? (
                <span className="text-xs text-ink-2 truncate" title={entry.clientIp}>{entry.hostname}</span>
              ) : (
                <span className="text-xs text-ink-3 font-mono truncate">{entry.clientIp}</span>
              )}
              <span className="text-xs text-ink-3 font-mono truncate group-hover:text-ink-2 transition-colors" title={entry.requestPath}>
                {entry.requestPath}
              </span>
              <span className="figure text-[13px] font-semibold text-ink text-right">{formatBytes(entry.bytesSent)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Status({ status }: { status: string }) {
  const cls =
    status === "HIT"
      ? "text-cache bg-cache/10"
      : status === "MISS"
        ? "text-internet bg-internet/10"
        : "text-ink-3 bg-raised";
  return <span className={`text-[10px] font-semibold tracking-wide text-center rounded px-1.5 py-0.5 ${cls}`}>{status}</span>;
}
