import { getDb } from "./db";
import type { SavedRange } from "./range";

export type { SavedRange };

/**
 * IPs/prefixes to exclude from stats by default (prefill traffic from the
 * cache host itself, which is supposed to miss heavily and skews real client data).
 * Configurable via the EXCLUDE_IPS env var (comma-separated).
 * Entries ending in "." or ":" are treated as prefixes (e.g. "172." for docker).
 */
export function getExcludedIps(): string[] {
  const raw = process.env.EXCLUDE_IPS ?? "127.0.0.1,::1,172.,localhost";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Build a SQL filter fragment that excludes the configured IPs.
 * Returns the clause (without WHERE/AND) and its bound params, or null if nothing to exclude.
 */
function ipExclusion(column: string, includeAll: boolean): { clause: string; params: string[] } | null {
  if (includeAll) return null;
  const ips = getExcludedIps();
  if (ips.length === 0) return null;
  const conds: string[] = [];
  const params: string[] = [];
  for (const ip of ips) {
    if (ip.endsWith(".") || ip.endsWith(":")) {
      conds.push(`${column} NOT LIKE ?`);
      params.push(`${ip}%`);
    } else {
      conds.push(`${column} <> ?`);
      params.push(ip);
    }
  }
  return { clause: conds.join(" AND "), params };
}

/**
 * An inclusive-start, exclusive-end window over hour buckets, expressed in
 * log-local wall-clock (see ADR-0001). Both bounds are hour strings: "2026-07-01T18".
 */
export interface TimeRange {
  start: string;
  end: string;
}

const HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

/** Build a TimeRange from raw query params, or null if absent/malformed/empty. */
export function parseTimeRange(start: string | null, end: string | null): TimeRange | null {
  if (!start || !end) return null;
  if (!HOUR_RE.test(start) || !HOUR_RE.test(end)) return null;
  if (end <= start) return null; // lexical compare is valid for fixed-width hour strings
  return { start, end };
}

/** Chart bucketing rule: ranges spanning ≤ 2 days show hourly bars, longer ranges daily. */
export function chooseGranularity(range: TimeRange): "hour" | "day" {
  const spanHours = (Date.parse(`${range.end}:00:00Z`) - Date.parse(`${range.start}:00:00Z`)) / 3_600_000;
  return spanHours <= 48 ? "hour" : "day";
}

export interface QueryOpts {
  includeAll?: boolean; // when true, do not exclude prefill/local IPs
  range?: TimeRange | null; // when set, restrict to this hour window (uses hourly_stats)
}

/**
 * Pick the rollup table and time-filter for a query. A bounded range uses
 * hourly_stats (finest retained granularity); all-time uses daily_stats (as before).
 */
function statsSource(range?: TimeRange | null): { table: string; timeClause: string; timeParams: string[] } {
  if (range) {
    return { table: "hourly_stats", timeClause: "hour >= ? AND hour < ?", timeParams: [range.start, range.end] };
  }
  return { table: "daily_stats", timeClause: "", timeParams: [] };
}

/** Combine the IP exclusion and time-range filters into a single WHERE for a rollup table. */
function buildFilter(opts: QueryOpts): { table: string; where: string; params: string[] } {
  const src = statsSource(opts.range);
  const ipf = ipExclusion("client_ip", !!opts.includeAll);
  const conds: string[] = [];
  const params: string[] = [];
  if (src.timeClause) {
    conds.push(src.timeClause);
    params.push(...src.timeParams);
  }
  if (ipf) {
    conds.push(ipf.clause);
    params.push(...ipf.params);
  }
  return { table: src.table, where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

export interface OverviewStats {
  totalRequests: number;
  totalBytesSent: number;
  cacheHitRate: number;        // by bytes
  cacheHitRateByReq: number;   // by request count
  servedFromCache: number;     // bytes served from cache (HIT)
  servedFromUpstream: number;  // bytes fetched from internet (MISS)
  totalClients: number;
  totalServices: number;
}

export interface ServiceStats {
  service: string;
  requests: number;
  bytesSent: number;
  cacheHits: number;
  cacheMisses: number;
  hitBytes: number;
  missBytes: number;
}

export interface ClientStats {
  clientIp: string;
  requests: number;
  bytesSent: number;
  cacheHits: number;
  cacheMisses: number;
  hitBytes: number;
  missBytes: number;
  topService: string;
}

export interface DailyBandwidth {
  day: string;
  bytesSent: number;
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  hitBytes: number;
  missBytes: number;
}

export interface RecentEntry {
  id: number;
  timestamp: string;
  service: string;
  clientIp: string;
  requestPath: string;
  bytesSent: number;
  cacheStatus: string;
  upstreamHost: string;
}

export function getOverviewStats(opts: QueryOpts = {}): OverviewStats {
  const db = getDb();
  const { table, where, params } = buildFilter(opts);

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(requests), 0) as totalRequests,
      COALESCE(SUM(bytes_sent), 0) as totalBytesSent,
      COALESCE(SUM(cache_hits), 0) as totalHits,
      COALESCE(SUM(cache_misses), 0) as totalMisses,
      COALESCE(SUM(hit_bytes), 0) as hitBytes,
      COALESCE(SUM(miss_bytes), 0) as missBytes
    FROM ${table} ${where}
  `).get(...params) as { totalRequests: number; totalBytesSent: number; totalHits: number; totalMisses: number; hitBytes: number; missBytes: number };

  const clientCount = db.prepare(`SELECT COUNT(DISTINCT client_ip) as count FROM ${table} ${where}`).get(...params) as { count: number };
  const serviceCount = db.prepare(`SELECT COUNT(DISTINCT service) as count FROM ${table} ${where}`).get(...params) as { count: number };

  const totalHitMiss = totals.totalHits + totals.totalMisses;
  const cacheHitRateByReq = totalHitMiss > 0 ? (totals.totalHits / totalHitMiss) * 100 : 0;

  const totalCacheableBytes = totals.hitBytes + totals.missBytes;
  const cacheHitRate = totalCacheableBytes > 0 ? (totals.hitBytes / totalCacheableBytes) * 100 : 0;

  return {
    totalRequests: totals.totalRequests,
    totalBytesSent: totals.totalBytesSent,
    cacheHitRate,
    cacheHitRateByReq,
    servedFromCache: totals.hitBytes,
    servedFromUpstream: totals.missBytes,
    totalClients: clientCount.count,
    totalServices: serviceCount.count,
  };
}

export function getServiceStats(limit = 20, opts: QueryOpts = {}): ServiceStats[] {
  const db = getDb();
  const { table, where, params } = buildFilter(opts);
  return db.prepare(`
    SELECT
      service,
      SUM(requests) as requests,
      SUM(bytes_sent) as bytesSent,
      SUM(cache_hits) as cacheHits,
      SUM(cache_misses) as cacheMisses,
      SUM(hit_bytes) as hitBytes,
      SUM(miss_bytes) as missBytes
    FROM ${table} ${where}
    GROUP BY service
    ORDER BY bytesSent DESC
    LIMIT ?
  `).all(...params, limit) as ServiceStats[];
}

export function getClientStats(limit = 50, opts: QueryOpts = {}): ClientStats[] {
  const db = getDb();
  const { table, where, params } = buildFilter(opts);
  const clients = db.prepare(`
    SELECT
      client_ip as clientIp,
      SUM(requests) as requests,
      SUM(bytes_sent) as bytesSent,
      SUM(cache_hits) as cacheHits,
      SUM(cache_misses) as cacheMisses,
      SUM(hit_bytes) as hitBytes,
      SUM(miss_bytes) as missBytes
    FROM ${table} ${where}
    GROUP BY client_ip
    ORDER BY bytesSent DESC
    LIMIT ?
  `).all(...params, limit) as ClientStats[];

  // Top service per client, honoring the same table + time window.
  const src = statsSource(opts.range);
  const svcTimeClause = src.timeClause ? ` AND ${src.timeClause}` : "";
  const topServiceStmt = db.prepare(`
    SELECT service, SUM(bytes_sent) as total
    FROM ${src.table}
    WHERE client_ip = ?${svcTimeClause}
    GROUP BY service
    ORDER BY total DESC
    LIMIT 1
  `);
  for (const client of clients) {
    const topService = topServiceStmt.get(client.clientIp, ...src.timeParams) as { service: string; total: number } | undefined;
    client.topService = topService?.service || "unknown";
  }

  return clients;
}

export function getDailyBandwidth(days = 30, opts: QueryOpts = {}): DailyBandwidth[] {
  const db = getDb();
  const filter = ipExclusion("client_ip", !!opts.includeAll);
  const where = filter ? `WHERE ${filter.clause}` : "";
  const params = filter ? filter.params : [];
  return db.prepare(`
    SELECT
      day,
      SUM(bytes_sent) as bytesSent,
      SUM(requests) as requests,
      SUM(cache_hits) as cacheHits,
      SUM(cache_misses) as cacheMisses,
      SUM(hit_bytes) as hitBytes,
      SUM(miss_bytes) as missBytes
    FROM daily_stats ${where}
    GROUP BY day
    ORDER BY day DESC
    LIMIT ?
  `).all(...params, days).reverse() as DailyBandwidth[];
}

export interface BandwidthPoint {
  bucket: string; // "2026-07-01" (day) or "2026-07-01T18" (hour)
  bytesSent: number;
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  hitBytes: number;
  missBytes: number;
}

/**
 * Bandwidth time series for the chart. With no range, returns the last 30 days
 * from daily_stats (legacy behaviour). With a range, buckets hourly_stats by
 * hour or day so the exact window boundaries are respected.
 */
export function getBandwidthSeries(opts: QueryOpts = {}): { granularity: "hour" | "day"; points: BandwidthPoint[] } {
  if (!opts.range) {
    const points = getDailyBandwidth(30, opts).map((d) => ({ ...d, bucket: d.day }));
    return { granularity: "day", points };
  }

  const db = getDb();
  const granularity = chooseGranularity(opts.range);
  const ipf = ipExclusion("client_ip", !!opts.includeAll);
  const conds = ["hour >= ? AND hour < ?"];
  const params: string[] = [opts.range.start, opts.range.end];
  if (ipf) {
    conds.push(ipf.clause);
    params.push(...ipf.params);
  }
  const bucketExpr = granularity === "hour" ? "hour" : "substr(hour, 1, 10)";
  const points = db.prepare(`
    SELECT
      ${bucketExpr} as bucket,
      SUM(bytes_sent) as bytesSent,
      SUM(requests) as requests,
      SUM(cache_hits) as cacheHits,
      SUM(cache_misses) as cacheMisses,
      SUM(hit_bytes) as hitBytes,
      SUM(miss_bytes) as missBytes
    FROM hourly_stats
    WHERE ${conds.join(" AND ")}
    GROUP BY bucket
    ORDER BY bucket
  `).all(...params) as BandwidthPoint[];
  return { granularity, points };
}

export function getRecentActivity(limit = 100, opts: QueryOpts = {}): RecentEntry[] {
  const db = getDb();
  const ipf = ipExclusion("client_ip", !!opts.includeAll);
  const conds: string[] = [];
  const params: string[] = [];
  // recent_activity keys off full timestamps ("2026-07-01T18:49:34"); comparing
  // against hour-string bounds works lexically since the hour is a prefix.
  if (opts.range) {
    conds.push("timestamp >= ? AND timestamp < ?");
    params.push(opts.range.start, opts.range.end);
  }
  if (ipf) {
    conds.push(ipf.clause);
    params.push(...ipf.params);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return db.prepare(`
    SELECT
      id,
      timestamp,
      service,
      client_ip as clientIp,
      request_path as requestPath,
      bytes_sent as bytesSent,
      cache_status as cacheStatus,
      upstream_host as upstreamHost
    FROM recent_activity ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limit) as RecentEntry[];
}

export function listSavedRanges(): SavedRange[] {
  const db = getDb();
  return db.prepare(
    `SELECT id, name, start, end, created_at as createdAt FROM saved_ranges ORDER BY start DESC, id DESC`
  ).all() as SavedRange[];
}

export function createSavedRange(name: string, start: string, end: string): SavedRange {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO saved_ranges (name, start, end, created_at) VALUES (?, ?, ?, ?)`
  ).run(name, start, end, createdAt);
  return { id: Number(info.lastInsertRowid), name, start, end, createdAt };
}

export function deleteSavedRange(id: number): boolean {
  const db = getDb();
  return db.prepare(`DELETE FROM saved_ranges WHERE id = ?`).run(id).changes > 0;
}

/** Cache retention window (days) used to estimate whether content is "likely still cached". */
export function cacheMaxAgeDays(): number {
  const v = Number(process.env.CACHE_MAX_AGE_DAYS);
  return Number.isFinite(v) && v > 0 ? v : 60;
}

export function isLikelyCached(lastSeen: string): boolean {
  const t = Date.parse(lastSeen.includes("T") ? lastSeen : lastSeen.replace(" ", "T"));
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= cacheMaxAgeDays() * 86400000;
}

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
  /** Has been served from cache at least once (cache HIT seen in logs). Inferred, not disk-verified. */
  servedFromCache: boolean;
  /** Last activity within the cache retention window → probably still on disk. Heuristic. */
  likelyCached: boolean;
}

export function getCachedGames(service?: string, limit = 200): CachedGame[] {
  const db = getDb();

  let query = `
    SELECT 
      service,
      game_id as gameId,
      game_name as gameName,
      image_url as imageUrl,
      first_seen as firstSeen,
      last_seen as lastSeen,
      total_bytes as totalBytes,
      hit_count as hitCount,
      miss_count as missCount
    FROM cached_games
  `;

  const params: (string | number)[] = [];

  if (service) {
    query += ` WHERE service = ?`;
    params.push(service);
  }

  query += ` ORDER BY total_bytes DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(query).all(...params) as CachedGame[];

  return rows.map((row) => ({
    ...row,
    servedFromCache: row.hitCount > 0,
    likelyCached: isLikelyCached(row.lastSeen),
  }));
}

export function updateGameName(service: string, gameId: string, gameName: string, imageUrl?: string) {
  const db = getDb();
  if (imageUrl) {
    db.prepare(`UPDATE cached_games SET game_name = ?, image_url = ? WHERE service = ? AND game_id = ?`).run(gameName, imageUrl, service, gameId);
  } else {
    db.prepare(`UPDATE cached_games SET game_name = ? WHERE service = ? AND game_id = ?`).run(gameName, service, gameId);
  }
}

/** Look up a resolved game name/image for a Steam depot from the cache table. */
export function getGameByDepot(depotId: string): { gameName: string; imageUrl: string } | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT game_name as gameName, image_url as imageUrl FROM cached_games WHERE service = 'steam' AND game_id = ?`
  ).get(depotId) as { gameName: string; imageUrl: string } | undefined;
  if (row && row.gameName && !row.gameName.startsWith("Depot ")) {
    return { gameName: row.gameName, imageUrl: row.imageUrl };
  }
  return null;
}
