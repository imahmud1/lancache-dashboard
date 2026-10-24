"use client";

import { useEffect, useState } from "react";
import { Activity, ChevronDown, Users } from "lucide-react";
import { PrefillBadge } from "./ClientsTable";
import { LiveChart, type LivePoint } from "./LiveChart";
import { Panel, Segmented, Empty, pct, useAnimatedNumber } from "./ui";
import { formatBytes, formatBits, getServiceLabel, getServiceColor, getServiceAbbr, formatDuration } from "@/lib/format";

export interface LiveGroup {
  key: string;
  service: string;
  gameName?: string;
  imageUrl?: string;
  depotId?: string;
  clients: number;
  speedBps: number;
  hitBps: number;
  missBps: number;
  totalBytes: number;
  excluded: boolean;
}

export interface LiveSnapshot {
  at: number;
  totalBps: number;
  peakBps: number;
  hitBps: number;
  missBps: number;
  activeClients: number;
  activeDownloads: number;
  groups: LiveGroup[];
  moreGroups: number;
  moreBps: number;
}

export interface LiveDownload {
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
  hostname?: string | null;
  excluded?: boolean;
}

export type SpeedUnit = "bytes" | "bits";

/** Splits a rate into a value and a smaller suffix for consistent styling. */
export function formatRate(bytesPerSec: number, unit: SpeedUnit): { value: string; suffix: string } {
  if (unit === "bits") {
    const [value, u] = formatBits(bytesPerSec).split(" ");
    return { value, suffix: u };
  }
  const [value, u] = formatBytes(bytesPerSec).split(" ");
  return { value, suffix: `${u}/s` };
}

const EMPTY: LiveSnapshot = {
  at: 0, totalBps: 0, peakBps: 0, hitBps: 0, missBps: 0, activeClients: 0, activeDownloads: 0, groups: [], moreGroups: 0, moreBps: 0,
};
const HISTORY = 300;

/** Subscribes to /api/live (SSE): grouped snapshot each second plus a rolling 5-minute history. */
export function useLive(includeAll: boolean): { connected: boolean; snapshot: LiveSnapshot; history: LivePoint[] } {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(EMPTY);
  const [history, setHistory] = useState<LivePoint[]>([]);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource(includeAll ? "/api/live?includeAll=1" : "/api/live");
      es.onopen = () => setConnected(true);
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data) as LiveSnapshot & { history?: LivePoint[] };
          setSnapshot({ ...EMPTY, ...d, groups: d.groups || [] });
          if (d.history) setHistory(d.history.slice(-HISTORY));
          else if (d.at) setHistory((h) => [...h, { t: d.at, hitBps: d.hitBps, missBps: d.missBps }].slice(-HISTORY));
          setConnected(true);
        } catch {
          /* ignore malformed frame */
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

  return { connected, snapshot, history };
}

/** Persisted bits/bytes preference, shared with the display page. */
export function useSpeedUnit(): [SpeedUnit, (u: SpeedUnit) => void] {
  const [unit, setUnit] = useState<SpeedUnit>("bytes");
  useEffect(() => {
    const saved = localStorage.getItem("speedUnit");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "bits" || saved === "bytes") setUnit(saved);
  }, []);
  const choose = (u: SpeedUnit) => {
    setUnit(u);
    localStorage.setItem("speedUnit", u);
  };
  return [unit, choose];
}

export function groupTitle(g: { gameName?: string; service: string; depotId?: string }): string {
  return g.gameName || (g.service === "steam" && g.depotId ? `Steam depot ${g.depotId}` : `${getServiceLabel(g.service)} downloads`);
}

/** Animated rate readout: value glides between samples. */
export function Rate({ bps, unit, className = "", suffixClassName = "" }: { bps: number; unit: SpeedUnit; className?: string; suffixClassName?: string }) {
  const v = useAnimatedNumber(bps, 700);
  const r = formatRate(v, unit);
  return (
    <span className={`figure ${className}`}>
      {r.value}
      <span className={suffixClassName}>{r.suffix}</span>
    </span>
  );
}

const COLLAPSED = 8;

export function LiveDownloads({ includeAll = false, className = "" }: { includeAll?: boolean; className?: string }) {
  const { connected, snapshot, history } = useLive(includeAll);
  const [unit, setUnit] = useSpeedUnit();
  const [showAll, setShowAll] = useState(false);
  const { groups, totalBps, peakBps, hitBps, missBps } = snapshot;
  const liveShare = pct(hitBps, hitBps + missBps);
  const visible = showAll ? groups : groups.slice(0, COLLAPSED);
  const maxBps = groups[0]?.speedBps || 1;

  return (
    <Panel
      title="Live downloads"
      icon={Activity}
      meta={snapshot.activeDownloads > 0 ? `${snapshot.activeDownloads} downloads · ${snapshot.activeClients} clients · ${groups.length + snapshot.moreGroups} games` : undefined}
      className={className}
      actions={
        <>
          <Segmented
            label="Speed unit"
            value={unit}
            onChange={setUnit}
            options={[
              { value: "bits", label: "bit/s" },
              { value: "bytes", label: "byte/s" },
            ]}
          />
          <span
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold ${
              connected ? "bg-accent/12 text-accent" : "bg-danger/12 text-danger"
            }`}
            role="status"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-accent animate-pulse" : "bg-danger"}`} aria-hidden />
            {connected ? "Live" : "Reconnecting"}
          </span>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(15rem,20rem)_1fr] items-stretch pb-5 mb-4 border-b border-line">
        <div className="flex flex-col justify-between gap-4">
          <div>
            <div className="text-xs text-ink-3">Right now</div>
            <Rate bps={totalBps} unit={unit} className="block text-[3.25rem] font-semibold leading-none mt-2 text-ink" suffixClassName="text-lg text-ink-3 ml-2 font-medium" />
          </div>
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="text-xs text-ink-3">Peak</dt>
              <dd className="mt-1">
                <Rate bps={peakBps} unit={unit} className="text-base font-semibold text-ink-2" suffixClassName="text-[11px] text-ink-3 ml-1" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Clients</dt>
              <dd className="figure text-base font-semibold text-ink-2 mt-1">{snapshot.activeClients}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">From cache</dt>
              <dd className={`figure text-base font-semibold mt-1 ${totalBps === 0 ? "text-ink-3" : liveShare >= 50 ? "text-cache" : "text-internet"}`}>
                {totalBps === 0 ? "—" : `${Math.round(liveShare)}%`}
              </dd>
            </div>
          </dl>
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between text-xs text-ink-3 mb-2">
            <span>Last 5 minutes</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-cache" aria-hidden />Cache</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-internet" aria-hidden />Internet</span>
            </span>
          </div>
          <LiveChart points={history} className="h-40" />
        </div>
      </div>

      {groups.length === 0 ? (
        <Empty icon={Activity} title="Nothing downloading right now" hint="Downloads appear here within a second of starting, grouped by game." />
      ) : (
        <>
          <ul className="grid gap-x-6 gap-y-1 xl:grid-cols-2">
            {visible.map((g) => (
              <GroupRow key={g.key} g={g} maxBps={maxBps} unit={unit} includeAll={includeAll} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <span className="text-xs text-ink-3">
              {snapshot.moreGroups > 0 && `+${snapshot.moreGroups} more games at ${formatRate(snapshot.moreBps, unit).value} ${formatRate(snapshot.moreBps, unit).suffix}`}
            </span>
            {groups.length > COLLAPSED && (
              <button
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-line bg-raised text-[13px] font-medium text-ink-2 hover:text-ink hover:border-line-strong transition-colors"
              >
                {showAll ? "Show top 8" : `Show all ${groups.length}`}
                <ChevronDown className={`w-4 h-4 transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden />
              </button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function GroupRow({ g, maxBps, unit, includeAll }: { g: LiveGroup; maxBps: number; unit: SpeedUnit; includeAll: boolean }) {
  const [open, setOpen] = useState(false);
  const share = Math.round(pct(g.hitBps, g.hitBps + g.missBps));
  const live = g.hitBps + g.missBps > 0;

  return (
    <li className="row-in rounded-lg hover:bg-raised/50 transition-colors">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-4 p-2 text-left">
        <Thumb src={g.imageUrl} service={g.service} className="w-[7.5rem] h-14" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] font-semibold text-ink truncate">{groupTitle(g)}</span>
            {g.excluded && <PrefillBadge />}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-ink-3">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getServiceColor(g.service) }} aria-hidden />
            <span className="text-ink-2">{getServiceLabel(g.service)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" aria-hidden />
              <span className="figure">{g.clients}</span>
            </span>
            {live && (
              <span className={`figure ${share >= 50 ? "text-cache" : "text-internet"}`}>· {share}% cache</span>
            )}
          </div>
          {/* Speed relative to the fastest game, split cache vs internet */}
          <div className="mt-2 h-1.5 rounded-full bg-raised overflow-hidden flex" aria-hidden>
            <div className="h-full bg-cache transition-[width] duration-700 ease-out" style={{ width: `${pct(g.hitBps, maxBps)}%` }} />
            <div className="h-full bg-internet/85 transition-[width] duration-700 ease-out" style={{ width: `${pct(g.missBps, maxBps)}%` }} />
          </div>
        </div>
        <div className="text-right shrink-0 w-24">
          <Rate bps={g.speedBps} unit={unit} className="text-lg font-semibold text-ink" suffixClassName="text-xs text-ink-3 ml-1 font-medium" />
          <div className="figure text-[11px] text-ink-3 mt-0.5">{formatBytes(g.totalBytes)}</div>
        </div>
        <ChevronDown className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && <GroupDetail groupKey={g.key} unit={unit} includeAll={includeAll} />}
    </li>
  );
}

/** Per-client rows for one game, fetched on expand and refreshed while open. */
function GroupDetail({ groupKey, unit, includeAll }: { groupKey: string; unit: SpeedUnit; includeAll: boolean }) {
  const [rows, setRows] = useState<LiveDownload[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/live/group?key=${encodeURIComponent(groupKey)}${includeAll ? "&includeAll=1" : ""}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setRows(d.downloads || []);
          setTotal(d.total || 0);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [groupKey, includeAll]);

  if (!rows) return <div className="px-4 pb-3 text-xs text-ink-3">Loading clients…</div>;
  if (rows.length === 0) return <div className="px-4 pb-3 text-xs text-ink-3">This download just finished.</div>;

  return (
    <div className="mx-2 mb-2 rounded-lg bg-ground/50 border border-line max-h-72 overflow-y-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-panel">
          <tr className="text-ink-3">
            <th scope="col" className="font-normal py-1.5 pl-3">Client</th>
            <th scope="col" className="font-normal py-1.5 text-right">Downloaded</th>
            <th scope="col" className="font-normal py-1.5 text-right">Cache</th>
            <th scope="col" className="font-normal py-1.5 pr-3 text-right">Speed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const share = Math.round(pct(d.hitBytes, d.hitBytes + d.missBytes));
            const r = formatRate(d.speedBps, unit);
            return (
              <tr key={d.key} className="border-t border-line">
                <td className="py-1.5 pl-3">
                  <span className="flex items-center gap-2 min-w-0">
                    {d.hostname ? <span className="text-ink truncate">{d.hostname}</span> : null}
                    <span className={d.hostname ? "font-mono text-ink-3" : "font-mono text-ink"}>{d.clientIp}</span>
                    {d.excluded && <PrefillBadge />}
                  </span>
                </td>
                <td className="figure py-1.5 text-right text-ink-2">
                  {formatBytes(d.totalBytes)} <span className="text-ink-3">in {formatDuration(d.durationSec)}</span>
                </td>
                <td className={`figure py-1.5 text-right ${share >= 50 ? "text-cache" : "text-internet"}`}>{share}%</td>
                <td className="figure py-1.5 pr-3 text-right text-ink font-semibold">
                  {r.value} <span className="text-ink-3 font-normal">{r.suffix}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {total > rows.length && <div className="px-3 py-1.5 text-[11px] text-ink-3 border-t border-line">Showing the fastest {rows.length} of {total}.</div>}
    </div>
  );
}

/** Game art when known; otherwise the service colour as a labelled swatch. */
export function Thumb({ src, service, className = "w-14 h-[26px]" }: { src?: string; service: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`${className} rounded-md overflow-hidden shrink-0 bg-raised ring-1 ring-white/5`}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-[10px] font-bold tracking-wide text-ink"
          style={{ backgroundColor: `${getServiceColor(service)}40` }}
        >
          {getServiceAbbr(service)}
        </div>
      )}
    </div>
  );
}
