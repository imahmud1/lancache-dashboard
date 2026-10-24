"use client";

import { useEffect, useState, useMemo } from "react";
import { Gamepad2, ChevronDown, Search, Info } from "lucide-react";
import { formatBytes, formatNumber, getServiceLabel, getServiceColor, getServiceAbbr } from "@/lib/format";
import { Panel, Segmented, Empty, hitTone, pct } from "./ui";

export interface CachedGame {
  service: string;
  gameId: string;
  gameName: string;
  imageUrl: string;
  firstSeen: string;
  lastSeen: string;
  totalBytes: number;
  hitCount: number;
  missCount: number;
  servedFromCache: boolean;
  likelyCached: boolean;
}

interface Summary {
  totalGames: number;
  gamesInCache: number;
  totalCachedBytes: number;
}

const EMPTY_SUMMARY: Summary = { totalGames: 0, gamesInCache: 0, totalCachedBytes: 0 };

/** Loads /api/games, re-polling while depots resolve and every `refreshMs` after. */
export function useGames(refreshMs = 0): { games: CachedGame[]; summary: Summary; loading: boolean } {
  const [games, setGames] = useState<CachedGame[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const res = await fetch("/api/games");
        const data = await res.json();
        if (cancelled) return;
        setGames(data.games || []);
        setSummary(data.summary || EMPTY_SUMMARY);
        // Still resolving depots server-side: check back soon, otherwise on the slow cadence
        if (data.resolving) timer = setTimeout(load, 4000);
        else if (refreshMs > 0) timer = setTimeout(load, refreshMs);
      } catch {
        if (!cancelled && refreshMs > 0) timer = setTimeout(load, refreshMs);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshMs]);

  return { games, summary, loading };
}

/** Unresolved titles are named by their service ("Riot Games content") and flagged, never presented as a game name. */
export function gameDisplayName(g: CachedGame): { name: string; resolved: boolean } {
  const resolved = !!g.gameName && !g.gameName.startsWith("Depot ");
  return { name: resolved ? g.gameName : `${getServiceLabel(g.service)} content`, resolved };
}

/** Pass `data` from a parent useGames() so the page fetches /api/games once. */
export function CachedGames({ data }: { data: ReturnType<typeof useGames> }) {
  const { games: allGames, summary, loading } = data;
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const services = useMemo(() => Array.from(new Set(allGames.map((g) => g.service))), [allGames]);

  const filteredGames = useMemo(() => {
    let games = allGames;
    if (serviceFilter !== "all") games = games.filter((g) => g.service === serviceFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      games = games.filter((g) => g.gameName.toLowerCase().includes(q) || g.gameId.toLowerCase().includes(q));
    }
    return games;
  }, [allGames, serviceFilter, search]);

  const visible = showAll || search ? filteredGames : filteredGames.slice(0, 8);
  const hasMore = !showAll && !search && filteredGames.length > 8;

  return (
    <Panel
      title="Cached games"
      icon={Gamepad2}
      meta={
        <span className="inline-flex items-center gap-2">
          <span className="rounded border border-internet/30 px-1.5 py-px text-[10px] font-semibold text-internet">Experimental</span>
          <span className="figure">{summary.totalGames} titles · all time</span>
        </span>
      }
      actions={
        <div className="flex items-center gap-5 text-xs">
          <span>
            <span className="figure text-sm font-semibold text-cache">{summary.gamesInCache}</span>
            <span className="text-ink-3 ml-1.5">likely cached</span>
          </span>
          <span>
            <span className="figure text-sm font-semibold text-ink">{formatBytes(summary.totalCachedBytes)}</span>
            <span className="text-ink-3 ml-1.5">served</span>
          </span>
        </div>
      }
    >
      <p className="flex items-start gap-2 text-xs text-ink-3 leading-relaxed mb-4 max-w-[75ch]">
        <Info className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
        <span>
          Inferred from access logs, not a scan of the cache folder. <span className="text-ink-2">Likely cached</span> means the title was active
          within the cache retention window, so it&apos;s probably still on disk. Evictions happen silently and aren&apos;t reflected here.
        </span>
      </p>

      {/* Search + service filter */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <label className="relative flex-1 min-w-[14rem]">
          <span className="sr-only">Search games</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3 pointer-events-none" aria-hidden />
          <input
            type="search"
            placeholder="Search games or IDs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 bg-ground/60 border border-line rounded-lg text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition-colors"
          />
        </label>
        {services.length > 0 && (
          <Segmented
            label="Filter by service"
            value={serviceFilter}
            onChange={setServiceFilter}
            options={[
              { value: "all", label: "All", count: allGames.length },
              ...services.map((svc) => ({
                value: svc,
                label: getServiceLabel(svc),
                count: allGames.filter((g) => g.service === svc).length,
              })),
            ]}
          />
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" aria-busy>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-line overflow-hidden">
              <div className="aspect-[460/215] bg-raised animate-pulse" />
              <div className="h-24 bg-panel" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Empty
          icon={Gamepad2}
          title={allGames.length === 0 ? "No games discovered yet" : "No games match your search"}
          hint={allGames.length === 0 ? "Games appear once their downloads are ingested." : "Try a different name or clear the filter."}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visible.map((game) => (
            <GameCard key={`${game.service}-${game.gameId}`} game={game} />
          ))}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => setShowAll(true)}
          className="flex items-center gap-2 mx-auto mt-5 h-9 px-4 text-[13px] font-medium text-ink-2 bg-panel border border-line rounded-lg hover:text-ink hover:border-line-strong transition-colors"
        >
          Show all {filteredGames.length} games
          <ChevronDown className="w-4 h-4" aria-hidden />
        </button>
      )}
    </Panel>
  );
}

/** Game header art with the store-API retry for stale Steam image URLs. */
export function GameArt({ game, className = "", label = true }: { game: CachedGame; className?: string; label?: boolean }) {
  const [imgErr, setImgErr] = useState(false);
  const [imgSrc, setImgSrc] = useState(game.imageUrl);
  const { name } = gameDisplayName(game);

  // When the PICS image 404s (common for unreleased titles), ask the store API
  // for the real (hashed) image URL and retry once before giving up.
  const handleImgError = async () => {
    const appId = game.service === "steam" ? (imgSrc || "").match(/\/apps\/(\d+)\//)?.[1] : undefined;
    if (!appId) {
      setImgErr(true);
      return;
    }
    try {
      const res = await fetch(`/api/games/image?appId=${appId}&depotId=${game.gameId}`);
      const data = await res.json();
      if (data.imageUrl && data.imageUrl !== imgSrc) {
        setImgSrc(data.imageUrl);
        return;
      }
    } catch {
      /* ignore */
    }
    setImgErr(true);
  };

  return (
    <div className={`relative overflow-hidden bg-raised ${className}`}>
      {imgSrc && !imgErr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt={name}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
          loading="lazy"
          onError={handleImgError}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: `${getServiceColor(game.service)}26` }}>
          {label && <span className="font-display [font-stretch:85%] text-lg font-semibold text-ink-2">{getServiceLabel(game.service)}</span>}
          {!label && <span className="text-[10px] font-semibold text-ink-2">{getServiceAbbr(game.service)}</span>}
        </div>
      )}
    </div>
  );
}

function GameCard({ game }: { game: CachedGame }) {
  const { name, resolved } = gameDisplayName(game);
  const total = game.hitCount + game.missCount;
  const hitRate = Math.round(pct(game.hitCount, total));
  const tone = hitTone(hitRate);

  return (
    <article className="group rounded-lg overflow-hidden border border-line bg-raised/40 transition-[transform,border-color,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_14px_32px_rgba(0,0,0,0.45)]">
      <div className="relative">
        <GameArt game={game} className="aspect-[460/215]" />
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2">
          <span className="px-1.5 py-0.5 rounded bg-ground/80 text-[10px] font-semibold text-ink-2">{getServiceLabel(game.service)}</span>
          {game.likelyCached ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-ground/80 text-[10px] font-semibold text-cache"
              title="Active within the cache retention window, so probably still on disk"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cache" aria-hidden />
              Likely cached
            </span>
          ) : game.servedFromCache ? (
            <span className="px-1.5 py-0.5 rounded bg-ground/80 text-[10px] font-semibold text-ink-3" title="Served from cache historically, but not recently. It may have been evicted.">
              Was cached
            </span>
          ) : null}
        </div>
      </div>

      <div className="p-3.5">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold leading-snug text-ink min-w-0" title={resolved ? name : `${name}: title not identified from the logs`}>
          <span className="truncate">{name}</span>
          {!resolved && <span className="shrink-0 text-[11px] font-medium text-ink-3">unresolved</span>}
        </h3>
        <div className="flex items-baseline justify-between mt-2">
          <span className="figure text-xl font-semibold text-ink leading-none">{formatBytes(game.totalBytes)}</span>
          <span className={`figure text-sm font-semibold ${tone.text}`}>{hitRate}% hit</span>
        </div>
        <div className="h-1 rounded-full bg-raised overflow-hidden mt-2" aria-hidden>
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(hitRate, 2)}%` }} />
        </div>
        <div className="flex items-center justify-between mt-2.5 text-[11px] text-ink-3">
          <span className="figure">
            {formatNumber(game.hitCount)} hits · {formatNumber(game.missCount)} misses
          </span>
          <span className="figure">Last {game.lastSeen.slice(0, 10)}</span>
        </div>
      </div>
    </article>
  );
}
