"use client";

import { formatBytes, formatNumber, getServiceLabel, getServiceColor } from "@/lib/format";
import { pct, useAnimatedNumber } from "./ui";

export interface Overview {
  totalRequests: number;
  totalBytesSent: number;
  cacheHitRate: number;
  cacheHitRateByReq: number;
  servedFromCache: number;
  servedFromUpstream: number;
  totalClients: number;
  totalServices: number;
}

interface ServiceRow {
  service: string;
  hitBytes: number;
}

function Bytes({ value, className = "", unitClassName = "" }: { value: number; className?: string; unitClassName?: string }) {
  const v = useAnimatedNumber(value, 1100);
  const [n, u] = formatBytes(v).split(" ");
  return (
    <span className={`figure ${className}`}>
      {n}
      <span className={unitClassName}> {u}</span>
    </span>
  );
}

const TOP_SERVICES = 5;

/**
 * The page's opening statement. Row 1: what the cache saved, its hit rate, and
 * what still came from the internet. Row 2: the cache/internet split. Row 3:
 * which services those savings came from. Row 4: the supporting totals.
 */
export function SummaryBand({ overview, rangeLabel, services = [] }: { overview: Overview | undefined; rangeLabel: string; services?: ServiceRow[] }) {
  const hit = overview?.servedFromCache ?? 0;
  const miss = overview?.servedFromUpstream ?? 0;
  const cacheable = hit + miss;
  const share = pct(hit, cacheable);
  const shown = useAnimatedNumber(share, 1100);
  const empty = cacheable === 0;

  const savers = [...services].filter((s) => s.hitBytes > 0).sort((a, b) => b.hitBytes - a.hitBytes);
  const top = savers.slice(0, TOP_SERVICES);
  const rest = savers.slice(TOP_SERVICES).reduce((s, x) => s + x.hitBytes, 0);
  const savedTotal = savers.reduce((s, x) => s + x.hitBytes, 0);

  return (
    <section aria-label="Cache summary" className="min-w-0 rounded-xl border border-line bg-panel overflow-hidden">
      <div className="px-5 pt-6 pb-5 sm:px-8 sm:pt-7">
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[1fr_auto] items-end">
          <div className="min-w-0">
            <p className="text-sm text-ink-2">
              Saved from the internet <span className="text-ink-3">· {rangeLabel}</span>
            </p>
            <p className="mt-2 leading-[0.9]">
              <Bytes value={hit} className="text-[clamp(3rem,7vw,5.5rem)] font-semibold text-ink" unitClassName="text-[0.42em] text-ink-2 font-medium" />
            </p>
          </div>

          <dl className="flex items-end gap-x-10 gap-y-4 flex-wrap">
            <div>
              <dt className="text-sm text-ink-2">Hit rate</dt>
              <dd className={`figure text-[clamp(2.25rem,4vw,3.25rem)] font-semibold leading-none mt-2 ${empty ? "text-ink-3" : "text-cache"}`}>
                {empty ? "—" : `${shown.toFixed(1)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-2">From the internet</dt>
              <dd className="mt-2 leading-none">
                <Bytes value={miss} className="text-[clamp(1.6rem,2.8vw,2.25rem)] font-semibold text-internet" unitClassName="text-[0.6em] font-medium" />
              </dd>
            </div>
          </dl>
        </div>

        {/* The split, labelled at its ends */}
        <div className="mt-6">
          <div
            className="flex h-3.5 rounded-full overflow-hidden bg-raised"
            role="img"
            aria-label={empty ? "No cacheable traffic yet" : `${share.toFixed(1)}% of cacheable traffic served from cache`}
          >
            {!empty && (
              <>
                <div className="bg-cache transition-[width] duration-1000 ease-out" style={{ width: `${shown}%` }} />
                <div className="bg-internet transition-[width] duration-1000 ease-out" style={{ width: `${100 - shown}%` }} />
              </>
            )}
          </div>
          <div className="flex justify-between mt-2 text-xs">
            <span className="text-cache font-medium">{empty ? "No cacheable traffic yet" : `${share.toFixed(1)}% stayed on the LAN`}</span>
            {!empty && <span className="text-ink-3">{(100 - share).toFixed(1)}% fetched upstream</span>}
          </div>
        </div>
      </div>

      {/* Where the savings came from */}
      {top.length > 0 && (
        <div className="border-t border-line px-5 py-4 sm:px-8">
          <h3 className="text-xs text-ink-3 mb-3">Savings by service</h3>
          <ul className="grid gap-x-6 gap-y-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {top.map((s) => (
              <SaverCell key={s.service} label={getServiceLabel(s.service)} color={getServiceColor(s.service)} bytes={s.hitBytes} share={pct(s.hitBytes, savedTotal)} />
            ))}
            {rest > 0 && <SaverCell label={`${savers.length - TOP_SERVICES} others`} color="var(--color-ink-3)" bytes={rest} share={pct(rest, savedTotal)} />}
          </ul>
        </div>
      )}

      <dl className="grid grid-cols-2 sm:grid-cols-4 border-t border-line [&>div]:border-line [&>div]:px-5 [&>div]:py-4 sm:[&>div]:px-8 [&>div:nth-child(odd)]:border-r sm:[&>div]:border-r sm:[&>div:last-child]:border-r-0 [&>div:nth-child(-n+2)]:border-b sm:[&>div:nth-child(-n+2)]:border-b-0">
        <Stat label="Total served" value={formatBytes(overview?.totalBytesSent ?? 0)} />
        <Stat label="Requests" value={formatNumber(overview?.totalRequests ?? 0)} sub={`${(overview?.cacheHitRateByReq ?? 0).toFixed(1)}% hit by count`} />
        <Stat label="Clients" value={String(overview?.totalClients ?? 0)} />
        <Stat label="Services" value={String(overview?.totalServices ?? 0)} />
      </dl>
    </section>
  );
}

/** One service's share of the bytes the cache saved. Service colour identifies; it never encodes performance. */
function SaverCell({ label, color, bytes, share }: { label: string; color: string; bytes: number; share: number }) {
  return (
    <li className="min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-[13px] text-ink-2 truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="figure text-lg font-semibold text-ink leading-none">{formatBytes(bytes)}</span>
        <span className="figure text-xs text-ink-3">{Math.round(share)}%</span>
      </div>
      <div className="mt-2 h-1 rounded-full bg-raised overflow-hidden" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.max(share, 2)}%`, backgroundColor: color }} />
      </div>
    </li>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="figure text-2xl font-semibold text-ink mt-1 leading-none">{value}</dd>
      {sub && <dd className="text-[11px] text-ink-3 mt-1.5">{sub}</dd>}
    </div>
  );
}
