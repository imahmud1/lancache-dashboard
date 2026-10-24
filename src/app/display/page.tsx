"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Maximize, Minimize, Users } from "lucide-react";
import { BrandMark, useBrand } from "@/components/Brand";
import { MeterRing } from "@/components/display/MeterRing";
import { LiveChart } from "@/components/LiveChart";
import { useLive, groupTitle, Thumb, Rate, type SpeedUnit, type LiveGroup } from "@/components/LiveDownloads";
import { useGames, gameDisplayName, GameArt, type CachedGame } from "@/components/CachedGames";
import { hitTone, pct, useAnimatedNumber } from "@/components/ui";
import { formatBytes, formatNumber, getServiceLabel, getServiceColor } from "@/lib/format";
import { ALL_TIME, RangeSelection, resolveSelection, selectionLabel, type SavedRange } from "@/lib/range";

// ---------------------------------------------------------------------------
// /display — fullscreen 16:9 event view. Read-only; no admin controls.
//
// URL options (all optional; otherwise this browser's dashboard choices apply):
//   ?hours=24              relative range        ?saved=<id>      a saved range
//   ?start=YYYY-MM-DDTHH&end=…  absolute range    ?prefill=show    include prefill
//   ?unit=bits|bytes       live speed unit       ?clients=hide    hide client identity
//
// Everything on the stage is sized in cqh (1% of stage height). Text floor 1.8cqh.
// ---------------------------------------------------------------------------

interface Overview {
  totalRequests: number;
  totalBytesSent: number;
  servedFromCache: number;
  servedFromUpstream: number;
  totalClients: number;
  totalServices: number;
}
interface ServiceRow { service: string; bytesSent: number; hitBytes: number; missBytes: number }
interface ClientRow { clientIp: string; bytesSent: number; hitBytes: number; missBytes: number; topService: string; hostname?: string | null }
interface RecentRow { id: number; timestamp: string; service: string; clientIp: string; bytesSent: number; cacheStatus: string; hostname?: string | null }

function useOptions() {
  const sp = useSearchParams();
  return useMemo(() => {
    const hours = Number(sp.get("hours"));
    const start = sp.get("start");
    const end = sp.get("end");
    const saved = Number(sp.get("saved"));
    let selection: RangeSelection | null = null;
    if (Number.isFinite(hours) && hours > 0) selection = { kind: "relative", hours };
    else if (start && end) selection = { kind: "custom", start, end };
    return {
      selection,
      savedId: Number.isInteger(saved) && saved > 0 ? saved : null,
      prefill: sp.get("prefill"),
      unit: sp.get("unit") as SpeedUnit | null,
      hideClients: sp.get("clients") === "hide",
    };
  }, [sp]);
}

export default function DisplayPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-ground" />}>
      <Display />
    </Suspense>
  );
}

function Display() {
  const opts = useOptions();
  const brand = useBrand();

  // Range + prefill + unit: URL wins, then this browser's dashboard settings.
  const [selection, setSelection] = useState<RangeSelection>(ALL_TIME);
  const [includeAll, setIncludeAll] = useState(false);
  const [unit, setUnit] = useState<SpeedUnit>("bytes");
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (opts.selection) setSelection(opts.selection);
    else if (!opts.savedId) {
      try {
        const saved = JSON.parse(localStorage.getItem("rangeSelection") || "null") as RangeSelection | null;
        if (saved && typeof saved.kind === "string") setSelection(saved);
      } catch {
        /* ignore */
      }
    }
    setIncludeAll(opts.prefill ? opts.prefill === "show" : localStorage.getItem("includeAll") === "1");
    const u = opts.unit ?? localStorage.getItem("speedUnit");
    if (u === "bits" || u === "bytes") setUnit(u);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [opts]);

  useEffect(() => {
    if (!opts.savedId) return;
    fetch("/api/ranges")
      .then((r) => r.json())
      .then((d: { ranges?: SavedRange[] }) => {
        const r = d.ranges?.find((x) => x.id === opts.savedId);
        if (r) setSelection({ kind: "saved", id: r.id, name: r.name, start: r.start, end: r.end });
      })
      .catch(() => {});
  }, [opts.savedId]);

  // Range-scoped data, refreshed every 30s like the dashboard.
  const [overview, setOverview] = useState<Overview | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (includeAll) p.set("includeAll", "1");
    const r = resolveSelection(selection);
    if (r) {
      p.set("start", r.start);
      p.set("end", r.end);
    }
    const q = p.toString() ? `?${p}` : "";
    try {
      const [s, c, rc] = await Promise.all([
        fetch(`/api/stats${q}`).then((x) => x.json()),
        fetch(`/api/clients${q}`).then((x) => x.json()),
        fetch(`/api/recent${q}`).then((x) => x.json()),
      ]);
      setOverview(s.overview ?? null);
      setServices(s.services ?? []);
      setClients(c.clients ?? []);
      setRecent(rc.recent ?? []);
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [includeAll, selection]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const { connected, snapshot, history } = useLive(includeAll);
  const { games } = useGames(5 * 60_000);

  // Fullscreen + idle chrome. Controls and cursor appear on movement, fade after 3s.
  const [chrome, setChrome] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const wake = () => {
      setChrome(true);
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => setChrome(false), 3000);
    };
    const onFs = () => setIsFull(!!document.fullscreenElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") toggleFullscreen();
      wake();
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      if (idle.current) clearTimeout(idle.current);
    };
  }, []);

  // Long-running screens: drift the stage a few pixels every 5 minutes to spare panels from burn-in.
  const [drift, setDrift] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const id = setInterval(() => setDrift({ x: Math.round(Math.random() * 6 - 3), y: Math.round(Math.random() * 6 - 3) }), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const hit = overview?.servedFromCache ?? 0;
  const miss = overview?.servedFromUpstream ?? 0;
  const totalFraction = hit + miss > 0 ? hit / (hit + miss) : null;
  const liveFraction = snapshot.hitBps + snapshot.missBps > 0 ? snapshot.hitBps / (snapshot.hitBps + snapshot.missBps) : null;
  const rangeLabel = selectionLabel(selection);

  // The hero: the fastest live download with art; when idle, the most-cached title.
  const liveHero = snapshot.groups.find((g) => g.imageUrl) ?? snapshot.groups[0];
  const featured = games.find((g) => g.imageUrl && gameDisplayName(g).resolved);
  const backdrop = liveHero?.imageUrl || featured?.imageUrl;

  return (
    <div className={`fixed inset-0 bg-ground grid place-items-center overflow-hidden ${chrome ? "" : "cursor-none"}`}>
      {/* Controls: only while the pointer is active. Not part of the stage. */}
      <div
        className={`fixed top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 transition-opacity duration-500 ${chrome ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <Link
          href="/"
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-panel/90 text-[13px] font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden /> Dashboard
        </Link>
        <button
          onClick={toggleFullscreen}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-panel/90 text-[13px] font-medium text-ink-2 hover:text-ink"
          title="Toggle fullscreen (F)"
        >
          {isFull ? <Minimize className="w-4 h-4" aria-hidden /> : <Maximize className="w-4 h-4" aria-hidden />}
          {isFull ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </div>

      {/* The stage: a fixed 16:9 size container, letterboxed. */}
      <div
        className="relative [container-type:size] overflow-hidden transition-transform duration-[2000ms]"
        style={{ width: "min(100vw, 177.78vh)", height: "min(56.25vw, 100vh)", transform: `translate(${drift.x}px, ${drift.y}px)` }}
      >
        <Backdrop src={backdrop} />

        <main
          aria-label="LanCache event display"
          className="absolute inset-0 grid gap-[1.6cqh] p-[2.4cqh] grid-cols-[5fr_6fr_5fr] grid-rows-[auto_minmax(0,1fr)_24cqh_6cqh]"
        >
          <header className="col-span-3 flex items-center justify-between gap-[2cqh]">
            <BrandMark brand={brand} className="text-[2.8cqh]" logoClassName="h-[5.2cqh]" />
            <div className="flex items-center gap-[2.4cqh] text-[1.9cqh]">
              <span className="text-ink-2">{rangeLabel}</span>
              {stale && <span className="text-internet">Data paused</span>}
              <span
                className={`inline-flex items-center gap-[0.8cqh] px-[1.4cqh] py-[0.6cqh] rounded-full font-semibold ${
                  connected ? "bg-accent/15 text-accent" : "bg-danger/15 text-danger"
                }`}
              >
                <span className={`w-[1cqh] h-[1cqh] rounded-full ${connected ? "bg-accent animate-pulse" : "bg-danger"}`} aria-hidden />
                {connected ? "Live" : "Reconnecting"}
              </span>
              <Clock />
            </div>
          </header>

          <NowPanel groups={snapshot.groups} moreGroups={snapshot.moreGroups} unit={unit} featured={featured} recent={recent} hideClients={opts.hideClients} />

          {/* Center: the meter */}
          <section aria-label="Cache performance" className={`${glass} flex flex-col items-center justify-center p-[2.4cqh] min-h-0`}>
            <MeterRing totalFraction={totalFraction} liveFraction={liveFraction} className="h-[33cqh]">
              {totalFraction === null ? (
                <>
                  <span className="figure text-[7cqh] font-semibold leading-none text-ink-3">—</span>
                  <span className="text-[1.8cqh] text-ink-3 mt-[1cqh]">No cacheable traffic yet</span>
                </>
              ) : (
                <>
                  <HitFigure value={totalFraction * 100} />
                  <span className="text-[1.9cqh] text-ink-2 mt-[1cqh]">served from cache</span>
                </>
              )}
            </MeterRing>
            <div className="grid grid-cols-3 gap-[2.4cqh] w-full mt-[2.6cqh] text-center">
              <BigBytes label="Saved" value={hit} tone="text-cache" />
              <BigBytes label="From internet" value={miss} tone="text-internet" />
              <BigBytes label="Total served" value={overview?.totalBytesSent ?? 0} tone="text-ink" />
            </div>
            <div className="flex items-center justify-center gap-[3cqh] mt-[1.8cqh] text-[1.8cqh] text-ink-3">
              <span><span className="figure text-ink-2 font-semibold">{formatNumber(overview?.totalRequests ?? 0)}</span> requests</span>
              <span><span className="figure text-ink-2 font-semibold">{overview?.totalClients ?? 0}</span> clients</span>
              <span><span className="figure text-ink-2 font-semibold">{overview?.totalServices ?? 0}</span> services</span>
            </div>
          </section>

          {/* Right: live throughput */}
          <section aria-label="Live throughput" className={`${glass} p-[2.4cqh] flex flex-col min-h-0`}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-[2.1cqh] font-semibold text-ink">Live throughput</h2>
              <span className="text-[1.8cqh] text-ink-3">
                Peak <Rate bps={snapshot.peakBps} unit={unit} className="text-ink-2 font-semibold" suffixClassName="ml-[0.3cqh]" />
              </span>
            </div>
            <Rate bps={snapshot.totalBps} unit={unit} className="block text-[8cqh] font-semibold leading-none text-ink mt-[1.6cqh]" suffixClassName="text-[2.6cqh] text-ink-3 ml-[0.8cqh] font-medium" />
            <div className="flex items-center gap-[2cqh] mt-[1.2cqh] text-[1.8cqh] text-ink-2">
              <span className="inline-flex items-center gap-[0.6cqh]"><Users className="w-[2cqh] h-[2cqh] text-ink-3" aria-hidden />{snapshot.activeClients} downloading</span>
              {liveFraction !== null && (
                <span className={`figure font-semibold ${liveFraction >= 0.5 ? "text-cache" : "text-internet"}`}>{Math.round(liveFraction * 100)}% from cache</span>
              )}
            </div>
            <div className="flex-1 min-h-0 mt-[1.6cqh] relative">
              <LiveChart points={history} className="absolute inset-0 h-full" labelPx={14} />
            </div>
            <div className="flex items-center justify-between text-[1.8cqh] text-ink-3 mt-[1cqh]">
              <span>Last 5 minutes</span>
              <span className="flex items-center gap-[1.6cqh]">
                <span className="flex items-center gap-[0.6cqh]"><span className="w-[1.3cqh] h-[1.3cqh] rounded-[0.3cqh] bg-cache" aria-hidden />Cache</span>
                <span className="flex items-center gap-[0.6cqh]"><span className="w-[1.3cqh] h-[1.3cqh] rounded-[0.3cqh] bg-internet" aria-hidden />Internet</span>
              </span>
            </div>
          </section>

          {/* Bottom: top games poster strip + top clients */}
          <div className="col-span-3 grid grid-cols-[10fr_6fr] gap-[1.6cqh] min-h-0">
            <TopGames games={games} />
            <ClientsStrip clients={clients} hide={opts.hideClients} />
          </div>

          <ServicesRibbon services={services} />
        </main>
      </div>
    </div>
  );
}

/** Translucent panel over the art backdrop: the colour of what's downloading shows through. */
const glass = "rounded-[1.4cqh] bg-panel/72 ring-1 ring-white/[0.06]";

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

/**
 * The room's colour follows what's downloading: the hero's cover art, blown up,
 * blurred and darkened, crossfading when the top download changes.
 */
function Backdrop({ src }: { src?: string }) {
  const [layers, setLayers] = useState<string[]>([]);
  useEffect(() => {
    if (!src) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayers((l) => (l[l.length - 1] === src ? l : [...l.slice(-1), src]));
  }, [src]);

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {layers.map((s) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={s}
          src={s}
          alt=""
          className="art-in absolute inset-0 w-full h-full object-cover [filter:blur(5cqh)_saturate(1.35)] opacity-55"
        />
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_40%,transparent_0%,var(--color-ground)_88%)]" />
      <div className="absolute inset-0 bg-ground/45" />
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="figure text-[3.2cqh] font-semibold text-ink leading-none" aria-label="Local time">
      {now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
    </span>
  );
}

function HitFigure({ value }: { value: number }) {
  const v = useAnimatedNumber(value, 1400);
  return (
    <span className={`figure text-[9cqh] font-semibold leading-[0.9] ${hitTone(Math.round(value)).text}`}>
      {v.toFixed(1)}
      <span className="text-[3.8cqh] ml-[0.3cqh]">%</span>
    </span>
  );
}

function BigBytes({ label, value, tone }: { label: string; value: number; tone: string }) {
  const v = useAnimatedNumber(value, 1400);
  const [n, u] = formatBytes(v).split(" ");
  return (
    <div className="min-w-0">
      <div className="text-[1.8cqh] text-ink-3">{label}</div>
      <div className={`figure text-[4.4cqh] font-semibold leading-none mt-[0.6cqh] ${tone}`}>
        {n}
        <span className="text-[2cqh] ml-[0.4cqh] font-medium">{u}</span>
      </div>
    </div>
  );
}

function clientName(c: { hostname?: string | null; clientIp: string }, hide: boolean, i: number): { text: string; ip: boolean } {
  if (hide) return { text: `Client ${i + 1}`, ip: false };
  return c.hostname ? { text: c.hostname, ip: false } : { text: c.clientIp, ip: true };
}

function ago(ts: string | undefined): string | null {
  if (!ts) return null;
  const t = Date.parse(`${ts}Z`); // recent_activity timestamps are UTC wall-clock
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Left: the fastest live download as a hero card, then the next ones. Idle: the most-cached game. */
function NowPanel({
  groups,
  moreGroups,
  unit,
  featured,
  recent,
  hideClients,
}: {
  groups: LiveGroup[];
  moreGroups: number;
  unit: SpeedUnit;
  featured?: CachedGame;
  recent: RecentRow[];
  hideClients: boolean;
}) {
  const hero = groups[0];
  const rest = groups.slice(1, 4);
  const extra = Math.max(0, groups.length - 4) + moreGroups;
  const maxBps = hero?.speedBps || 1;

  if (!hero) return <IdlePanel featured={featured} recent={recent} hideClients={hideClients} />;

  const share = Math.round(pct(hero.hitBps, hero.hitBps + hero.missBps));
  return (
    <section aria-label="Now downloading" className={`${glass} p-[2.4cqh] flex flex-col min-h-0`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[2.1cqh] font-semibold text-ink">Now downloading</h2>
        <span className="text-[1.8cqh] text-ink-3">{groups.length + moreGroups} games</span>
      </div>

      <article key={hero.key} className="row-in mt-[1.6cqh]">
        <div className="relative rounded-[1cqh] overflow-hidden ring-1 ring-white/10 h-[19cqh]">
          <HeroArt key={hero.imageUrl} src={hero.imageUrl} service={hero.service} />
          <div className="absolute inset-0 bg-gradient-to-t from-ground/90 via-ground/20 to-transparent" />
          <div className="absolute left-[1.6cqh] right-[1.6cqh] bottom-[1.2cqh] flex items-end justify-between gap-[1.6cqh]">
            <div className="min-w-0">
              <div className="text-[3cqh] font-semibold text-ink leading-tight truncate">{groupTitle(hero)}</div>
              <div className="text-[1.8cqh] text-ink-2 flex items-center gap-[1cqh]">
                <span>{getServiceLabel(hero.service)}</span>
                <span aria-hidden>·</span>
                <span className="figure">{hero.clients} {hero.clients === 1 ? "client" : "clients"}</span>
                <span className={`figure font-semibold ${share >= 50 ? "text-cache" : "text-internet"}`}>{share}% cache</span>
              </div>
            </div>
            <Rate bps={hero.speedBps} unit={unit} className="text-[4.2cqh] font-semibold text-ink leading-none shrink-0" suffixClassName="text-[1.8cqh] text-ink-2 ml-[0.4cqh]" />
          </div>
        </div>
      </article>

      <ul className="mt-[1.8cqh] flex flex-col gap-[1.4cqh] min-h-0 overflow-hidden">
        {rest.map((g) => (
          <li key={g.key} className="row-in grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[1.4cqh]">
            <Thumb src={g.imageUrl} service={g.service} className="w-[9.6cqh] h-[4.5cqh]" />
            <div className="min-w-0">
              <div className="text-[2cqh] font-medium text-ink truncate">{groupTitle(g)}</div>
              <div className="mt-[0.5cqh] h-[0.6cqh] rounded-full bg-raised overflow-hidden flex" aria-hidden>
                <div className="bg-cache transition-[width] duration-700" style={{ width: `${pct(g.hitBps, maxBps)}%` }} />
                <div className="bg-internet/85 transition-[width] duration-700" style={{ width: `${pct(g.missBps, maxBps)}%` }} />
              </div>
            </div>
            <div className="text-right">
              <Rate bps={g.speedBps} unit={unit} className="text-[2.2cqh] font-semibold text-ink" suffixClassName="text-[1.8cqh] text-ink-3 ml-[0.3cqh]" />
              <div className="figure text-[1.8cqh] text-ink-3">{g.clients} {g.clients === 1 ? "client" : "clients"}</div>
            </div>
          </li>
        ))}
      </ul>
      {extra > 0 && <div className="mt-auto pt-[1cqh] text-[1.8cqh] text-ink-3">+{extra} more {extra === 1 ? "game" : "games"} downloading</div>}
    </section>
  );
}

/** Idle: lead with the most-cached title, then recent activity by client. */
function IdlePanel({ featured, recent, hideClients }: { featured?: CachedGame; recent: RecentRow[]; hideClients: boolean }) {
  const groups = useMemo(() => {
    const m = new Map<string, { service: string; clientIp: string; hostname?: string | null; bytes: number; requests: number }>();
    for (const r of recent) {
      const k = `${r.service}|${r.clientIp}`;
      const g = m.get(k) ?? { service: r.service, clientIp: r.clientIp, hostname: r.hostname, bytes: 0, requests: 0 };
      g.bytes += r.bytesSent;
      g.requests += 1;
      m.set(k, g);
    }
    return Array.from(m.values()).sort((a, b) => b.bytes - a.bytes).slice(0, 3);
  }, [recent]);
  const last = ago(recent[0]?.timestamp);
  const rate = featured ? Math.round(pct(featured.hitCount, featured.hitCount + featured.missCount)) : 0;

  return (
    <section aria-label="Now downloading" className={`${glass} p-[2.4cqh] flex flex-col min-h-0`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[2.1cqh] font-semibold text-ink">Quiet right now</h2>
        {last && <span className="text-[1.8cqh] text-ink-3">Last request {last}</span>}
      </div>
      {featured && (
        <article className="mt-[1.6cqh]">
          <div className="relative rounded-[1cqh] overflow-hidden ring-1 ring-white/10 h-[19cqh]">
            <GameArt game={featured} label={false} className="absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-t from-ground/90 via-ground/20 to-transparent" />
            <div className="absolute left-[1.6cqh] right-[1.6cqh] bottom-[1.2cqh]">
              <div className="text-[1.8cqh] text-ink-2">Most cached</div>
              <div className="flex items-end justify-between gap-[1.6cqh]">
                <div className="text-[3cqh] font-semibold text-ink leading-tight truncate">{gameDisplayName(featured).name}</div>
                <div className="text-right shrink-0">
                  <span className="figure text-[3.4cqh] font-semibold text-ink">{formatBytes(featured.totalBytes)}</span>
                  <span className={`figure text-[1.8cqh] font-semibold ml-[1cqh] ${hitTone(rate).text}`}>{rate}% hit</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      )}
      <div className="text-[1.8cqh] text-ink-3 mt-[1.8cqh] mb-[1cqh]">Recent activity</div>
      <ul className="flex flex-col gap-[1.2cqh] overflow-hidden">
        {groups.map((g, i) => {
          const who = clientName(g, hideClients, i);
          return (
            <li key={`${g.service}|${g.clientIp}`} className="flex items-baseline justify-between gap-[1.2cqh]">
              <span className="min-w-0 truncate">
                <span className={`text-[2cqh] text-ink ${who.ip ? "figure" : "font-medium"}`}>{who.text}</span>
                <span className="text-[1.8cqh] text-ink-3"> · {getServiceLabel(g.service)}</span>
              </span>
              <span className="figure text-[2.2cqh] font-semibold text-ink shrink-0">{formatBytes(g.bytes)}</span>
            </li>
          );
        })}
        {groups.length === 0 && <li className="text-[1.9cqh] text-ink-3">No requests in this range yet.</li>}
      </ul>
    </section>
  );
}

/** Bottom-left: the titles that moved the most bytes, as a poster row with ranks. */
function TopGames({ games }: { games: CachedGame[] }) {
  const top = games.slice(0, 5);
  return (
    <section aria-label="Top games" className={`${glass} p-[2.2cqh] flex flex-col min-h-0`}>
      <div className="flex items-baseline justify-between mb-[1.4cqh]">
        <h2 className="text-[2.1cqh] font-semibold text-ink">Top games</h2>
        <span className="text-[1.8cqh] text-ink-3">All time</span>
      </div>
      {top.length === 0 ? (
        <p className="text-[1.9cqh] text-ink-3">No games identified yet.</p>
      ) : (
        <ol className="grid grid-cols-5 gap-[1.6cqh] min-h-0">
          {top.map((g, i) => {
            const { name } = gameDisplayName(g);
            const rate = Math.round(pct(g.hitCount, g.hitCount + g.missCount));
            return (
              <li key={`${g.service}-${g.gameId}`} className="min-w-0">
                <div className="relative rounded-[0.8cqh] overflow-hidden ring-1 ring-white/10">
                  <GameArt game={g} className="aspect-[460/215]" />
                  <span className="figure absolute left-[0.8cqh] bottom-[0.2cqh] text-[4.2cqh] font-bold leading-none text-white [text-shadow:0_0.3cqh_1.2cqh_rgba(0,0,0,0.85)]">
                    {i + 1}
                  </span>
                </div>
                <div className="text-[1.9cqh] font-medium text-ink truncate mt-[0.8cqh]" title={name}>{name}</div>
                <div className="flex items-baseline gap-[0.8cqh] whitespace-nowrap">
                  <span className="figure text-[2.1cqh] font-semibold text-ink">{formatBytes(g.totalBytes)}</span>
                  <span className={`figure text-[1.8cqh] font-semibold ${hitTone(rate).text}`}>{rate}%</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function ClientsStrip({ clients, hide }: { clients: ClientRow[]; hide: boolean }) {
  const top = clients.slice(0, 5);
  const max = top[0]?.bytesSent || 1;
  return (
    <section aria-label="Top clients" className={`${glass} p-[2.2cqh] flex flex-col min-h-0`}>
      <div className="flex items-baseline justify-between mb-[1cqh]">
        <h2 className="text-[2.1cqh] font-semibold text-ink">Top clients</h2>
        <span className="text-[1.8cqh] text-ink-3">{clients.length} by bandwidth</span>
      </div>
      {top.length === 0 ? (
        <p className="text-[1.9cqh] text-ink-3">No client data in this range yet.</p>
      ) : (
        <ol className="flex flex-col justify-between flex-1 min-h-0">
          {top.map((c, i) => {
            const rate = Math.round(pct(c.hitBytes, c.hitBytes + c.missBytes));
            const who = clientName(c, hide, i);
            return (
              <li key={c.clientIp} className="grid grid-cols-[2.4cqh_minmax(0,1fr)_10cqh_11cqh] items-center gap-[1.2cqh]">
                <span className="figure text-[1.9cqh] text-ink-3">{i + 1}</span>
                <span className={`text-[2cqh] text-ink truncate ${who.ip ? "figure" : "font-medium"}`}>{who.text}</span>
                <div className="flex items-center gap-[0.8cqh]">
                  <div className="flex-1 h-[0.6cqh] rounded-full bg-raised overflow-hidden" aria-hidden>
                    <div className="h-full bg-ink-3/50 rounded-full" style={{ width: `${pct(c.bytesSent, max)}%` }} />
                  </div>
                  <span className={`figure text-[1.8cqh] font-semibold w-[4.6cqh] text-right ${hitTone(rate).text}`}>{rate}%</span>
                </div>
                <span className="figure text-[2.1cqh] font-semibold text-ink text-right">{formatBytes(c.bytesSent)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** A single-line ribbon: share of bytes by service, labelled inline. */
function ServicesRibbon({ services }: { services: ServiceRow[] }) {
  const total = services.reduce((s, x) => s + x.bytesSent, 0);
  const top = services.slice(0, 5);
  return (
    <section aria-label="Services" className={`${glass} col-span-3 px-[2.2cqh] flex items-center gap-[2.4cqh] min-h-0`}>
      <h2 className="text-[2cqh] font-semibold text-ink shrink-0">Services</h2>
      <div className="flex h-[1.6cqh] w-[34cqh] shrink-0 rounded-full overflow-hidden bg-raised gap-[0.2cqh]" role="img" aria-label="Traffic share by service">
        {services.map((s) => (
          <div key={s.service} style={{ width: `${pct(s.bytesSent, total)}%`, backgroundColor: getServiceColor(s.service) }} />
        ))}
      </div>
      {/* Wraps instead of clipping: items that don't fit drop to a hidden second line */}
      <ul className="flex flex-wrap items-center gap-x-[2.6cqh] gap-y-[2cqh] h-[3.2cqh] min-w-0 flex-1 overflow-hidden">
        {top.map((s) => {
          const rate = Math.round(pct(s.hitBytes, s.hitBytes + s.missBytes));
          return (
            <li key={s.service} className="flex items-baseline gap-[0.8cqh] whitespace-nowrap">
              <span className="w-[1.3cqh] h-[1.3cqh] rounded-[0.3cqh] self-center" style={{ backgroundColor: getServiceColor(s.service) }} aria-hidden />
              <span className="text-[1.9cqh] text-ink-2">{getServiceLabel(s.service)}</span>
              <span className="figure text-[2.1cqh] font-semibold text-ink">{formatBytes(s.bytesSent)}</span>
              <span className={`figure text-[1.8cqh] font-semibold ${hitTone(rate).text}`}>{rate}%</span>
            </li>
          );
        })}
      </ul>
      <span className="text-[1.8cqh] text-ink-3 shrink-0 figure">{formatBytes(total)} total</span>
    </section>
  );
}

/** Full-bleed hero art: the game's cover, or the service colour when there's none. */
function HeroArt({ src, service }: { src?: string; service: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" onError={() => setFailed(true)} />;
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: `${getServiceColor(service)}33` }}>
      <span className="text-[3.6cqh] font-semibold text-ink-2">{getServiceLabel(service)}</span>
    </div>
  );
}
