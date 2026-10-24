import fs from "fs";
import path from "path";
import { parseLine, extractGameId } from "./parser";
import { getGameByDepot } from "./queries";
import { getExcludedIps, isExcludedIp } from "./ip-filter";
import { extractDepotId } from "./steam-resolver";
import { resolveBattleNetGame, getBattleNetImageUrl } from "./battlenet-resolver";
import { resolveEpicName } from "./epic-resolver";
import { getGameOverride } from "./game-overrides";

const LOG_PATH = process.env.LOG_PATH || path.join(process.cwd(), "..", "logs", "access.log");

// A session is "active" if it had activity within this window.
const ACTIVE_MS = 30_000;
// Drop sessions entirely after this much inactivity.
const PRUNE_MS = 120_000;
// New activity after this gap starts a fresh session (resets totals).
const SESSION_GAP_MS = 60_000;
// Sliding window used for speed calculation.
const SPEED_WINDOW_MS = 10_000;

interface Session {
  key: string;
  clientIp: string;
  service: string;
  gameName?: string;
  imageUrl?: string;
  appId?: string;
  depotId?: string;
  totalBytes: number;
  hitBytes: number;
  missBytes: number;
  requests: number;
  startedAt: number;
  lastSeen: number;
  /** cache: "HIT" | "MISS" | other, so the live speed can be split cache vs internet. */
  window: { bytes: number; ts: number; cache: string }[];
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
  /** Client is on the prefill/exclude list (only visible when includeAll). */
  excluded: boolean;
}

interface TrackerState {
  sessions: Map<string, Session>;
  position: number;
  fileBuffer: string;
  intervalId: ReturnType<typeof setInterval> | null;
  peakBps: number;
  depotNameCache: Map<string, { gameName: string; imageUrl: string }>;
}

// Stored on globalThis so the instrumentation startup and the API route handlers
// share the SAME state even if Next bundles them as separate module instances.
const g = globalThis as unknown as { __lancacheLiveTracker?: TrackerState };

function state(): TrackerState {
  if (!g.__lancacheLiveTracker) {
    g.__lancacheLiveTracker = {
      sessions: new Map(),
      position: 0,
      fileBuffer: "",
      intervalId: null,
      peakBps: 0,
      depotNameCache: new Map(),
    };
  }
  return g.__lancacheLiveTracker;
}

function resolveDepot(depotId: string): { gameName?: string; imageUrl?: string } {
  const cache = state().depotNameCache;
  if (cache.has(depotId)) return cache.get(depotId)!;
  const hit = getGameByDepot(depotId);
  if (hit) {
    cache.set(depotId, hit);
    return hit;
  }
  return {};
}

function sessionKey(clientIp: string, service: string, gameName?: string): string {
  // Group Steam by resolved game so all its depots merge into one download.
  if (service === "steam" && gameName) return `${clientIp}|steam|${gameName}`;
  return `${clientIp}|${service}`;
}

function ingestLine(line: string) {
  const entry = parseLine(line);
  if (!entry) return;

  const now = Date.now();
  let gameName: string | undefined;
  let imageUrl: string | undefined;
  let depotId: string | undefined;

  if (entry.service === "steam") {
    depotId = extractDepotId(entry.path) || undefined;
    if (depotId) {
      const r = resolveDepot(depotId);
      gameName = r.gameName;
      imageUrl = r.imageUrl;
    }
  } else if (entry.service === "blizzard") {
    const hostMatch = entry.upstreamHost.match(/^([a-z0-9_]+?)(?:-assets)?\.cdn\.blizzard\.com$/i);
    const productCode = hostMatch ? hostMatch[1] : null;
    if (productCode) {
      gameName = resolveBattleNetGame(productCode) || productCode;
      imageUrl = getBattleNetImageUrl(productCode) || undefined;
      depotId = productCode;
    }
  } else if (entry.service === "epicgames") {
    const artifact = extractGameId(entry.service, entry.path, entry.upstreamHost);
    if (artifact) {
      gameName = resolveEpicName(artifact);
      depotId = artifact;
    }
  }

  // Operator overrides (data/game-overrides.json) win over built-in resolution.
  if (depotId) {
    const o = getGameOverride(entry.service, depotId);
    if (o?.name) gameName = o.name;
    if (o?.image) imageUrl = o.image;
  }

  const key = sessionKey(entry.clientIp, entry.service, gameName);
  const sessions = state().sessions;
  let s = sessions.get(key);

  // Start a fresh session if none or there was a long gap
  if (!s || now - s.lastSeen > SESSION_GAP_MS) {
    s = {
      key,
      clientIp: entry.clientIp,
      service: entry.service,
      gameName,
      imageUrl,
      appId: undefined,
      depotId,
      totalBytes: 0,
      hitBytes: 0,
      missBytes: 0,
      requests: 0,
      startedAt: now,
      lastSeen: now,
      window: [],
    };
    sessions.set(key, s);
  }

  // Fill in game info if it resolved later
  if (!s.gameName && gameName) s.gameName = gameName;
  if (!s.imageUrl && imageUrl) s.imageUrl = imageUrl;
  if (!s.depotId && depotId) s.depotId = depotId;

  s.totalBytes += entry.bytesSent;
  s.requests += 1;
  if (entry.cacheStatus === "HIT") s.hitBytes += entry.bytesSent;
  else if (entry.cacheStatus === "MISS") s.missBytes += entry.bytesSent;
  s.lastSeen = now;
  s.window.push({ bytes: entry.bytesSent, ts: now, cache: entry.cacheStatus });
}

// ---------------------------------------------------------------------------
// Snapshots. Computed ONCE per second in tick() (not once per viewer), grouped
// by game so a 300-seat event is 25 readable rows, not 300 raw sessions. The
// SSE route only serves the cached result, so cost is flat in viewer count.
// ---------------------------------------------------------------------------

/** One game (or service, when the title is unknown) being downloaded right now. */
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
  /** Every client in the group is on the prefill/exclude list. */
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
  /** Groups beyond the cap, and their combined speed. */
  moreGroups: number;
  moreBps: number;
}

export interface LivePoint {
  t: number;
  hitBps: number;
  missBps: number;
}

const GROUP_CAP = 25;
const HISTORY_POINTS = 300; // 5 minutes at 1s
const DETAIL_CAP = 200;

interface ModeCache {
  snapshot: LiveSnapshot;
  downloads: LiveDownload[];
  history: LivePoint[];
  peakBps: number;
}

const gs = globalThis as unknown as { __lancacheLiveModes?: Record<"public" | "all", ModeCache> };

function emptyMode(): ModeCache {
  return {
    snapshot: { at: 0, totalBps: 0, peakBps: 0, hitBps: 0, missBps: 0, activeClients: 0, activeDownloads: 0, groups: [], moreGroups: 0, moreBps: 0 },
    downloads: [],
    history: [],
    peakBps: 0,
  };
}

function modes(): Record<"public" | "all", ModeCache> {
  if (!gs.__lancacheLiveModes) gs.__lancacheLiveModes = { public: emptyMode(), all: emptyMode() };
  return gs.__lancacheLiveModes;
}

export function groupKey(service: string, gameName?: string): string {
  return `${service}|${gameName ?? ""}`;
}

/** Prune stale sessions, trim speed windows, and rebuild both cached snapshots. */
function refreshSnapshots() {
  const st = state();
  const now = Date.now();
  const excludedList = getExcludedIps();
  const secs = SPEED_WINDOW_MS / 1000;

  const all: (LiveDownload & { hitWin: number; missWin: number })[] = [];
  for (const [key, s] of st.sessions) {
    if (now - s.lastSeen > PRUNE_MS) {
      st.sessions.delete(key);
      continue;
    }
    // Trim every second, viewers or not, so windows can't grow unbounded.
    s.window = s.window.filter((w) => now - w.ts <= SPEED_WINDOW_MS);
    if (now - s.lastSeen > ACTIVE_MS) continue;

    let bytes = 0;
    let hitWin = 0;
    let missWin = 0;
    for (const w of s.window) {
      bytes += w.bytes;
      if (w.cache === "HIT") hitWin += w.bytes;
      else if (w.cache === "MISS") missWin += w.bytes;
    }
    all.push({
      key: s.key,
      clientIp: s.clientIp,
      service: s.service,
      gameName: s.gameName,
      imageUrl: s.imageUrl,
      depotId: s.depotId,
      totalBytes: s.totalBytes,
      hitBytes: s.hitBytes,
      missBytes: s.missBytes,
      requests: s.requests,
      durationSec: Math.round((s.lastSeen - s.startedAt) / 1000),
      speedBps: bytes / secs,
      excluded: isExcludedIp(s.clientIp, excludedList),
      hitWin,
      missWin,
    });
  }
  all.sort((a, b) => b.speedBps - a.speedBps);

  for (const mode of ["public", "all"] as const) {
    const m = modes()[mode];
    const rows = mode === "all" ? all : all.filter((d) => !d.excluded);

    const groups = new Map<string, LiveGroup & { ips: Set<string>; allExcluded: boolean }>();
    let hit = 0;
    let miss = 0;
    let total = 0;
    const clients = new Set<string>();
    for (const d of rows) {
      total += d.speedBps;
      hit += d.hitWin / secs;
      miss += d.missWin / secs;
      clients.add(d.clientIp);
      const k = groupKey(d.service, d.gameName);
      let gr = groups.get(k);
      if (!gr) {
        gr = { key: k, service: d.service, gameName: d.gameName, imageUrl: d.imageUrl, depotId: d.depotId, clients: 0, speedBps: 0, hitBps: 0, missBps: 0, totalBytes: 0, excluded: true, ips: new Set(), allExcluded: true };
        groups.set(k, gr);
      }
      gr.ips.add(d.clientIp);
      gr.speedBps += d.speedBps;
      gr.hitBps += d.hitWin / secs;
      gr.missBps += d.missWin / secs;
      gr.totalBytes += d.totalBytes;
      if (!gr.imageUrl && d.imageUrl) gr.imageUrl = d.imageUrl;
      if (!d.excluded) gr.allExcluded = false;
    }

    const sorted = Array.from(groups.values())
      .map(({ ips, allExcluded, ...g }) => ({ ...g, clients: ips.size, excluded: allExcluded }))
      .sort((a, b) => b.speedBps - a.speedBps);
    const top = sorted.slice(0, GROUP_CAP);
    const rest = sorted.slice(GROUP_CAP);

    m.peakBps = Math.max(m.peakBps, total);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    m.downloads = rows.map(({ hitWin, missWin, ...d }) => d);
    m.snapshot = {
      at: now,
      totalBps: total,
      peakBps: m.peakBps,
      hitBps: hit,
      missBps: miss,
      activeClients: clients.size,
      activeDownloads: rows.length,
      groups: top,
      moreGroups: rest.length,
      moreBps: rest.reduce((s, g) => s + g.speedBps, 0),
    };
    m.history.push({ t: now, hitBps: hit, missBps: miss });
    if (m.history.length > HISTORY_POINTS) m.history.splice(0, m.history.length - HISTORY_POINTS);
  }
}

function tick() {
  const st = state();
  refreshSnapshots();

  let size = 0;
  try {
    size = fs.statSync(LOG_PATH).size;
  } catch {
    return;
  }

  // Handle rotation
  if (size < st.position) {
    st.position = 0;
    st.fileBuffer = "";
  }
  if (size <= st.position) return;

  try {
    const stream = fs.createReadStream(LOG_PATH, { start: st.position, end: size - 1, encoding: "utf-8" });
    let chunk = "";
    stream.on("data", (d) => (chunk += d));
    stream.on("end", () => {
      st.position = size;
      st.fileBuffer += chunk;
      const lines = st.fileBuffer.split("\n");
      st.fileBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) ingestLine(line);
      }
    });
    stream.on("error", () => {});
  } catch {
    // retry next tick
  }
}

export function startLiveTracker() {
  const st = state();
  if (st.intervalId) return;
  try {
    st.position = fs.statSync(LOG_PATH).size; // begin at EOF — only track new activity
  } catch {
    st.position = 0;
  }
  console.log("[live-tracker] Watching for real-time downloads");
  st.intervalId = setInterval(tick, 1000);
}

export function stopLiveTracker() {
  const st = state();
  if (st.intervalId) {
    clearInterval(st.intervalId);
    st.intervalId = null;
  }
}

/** The cached per-second snapshot (grouped, capped). Prefill/excluded clients are hidden unless includeAll. */
export function getLiveSnapshot(includeAll = false): LiveSnapshot {
  return modes()[includeAll ? "all" : "public"].snapshot;
}

/** Up to five minutes of 1-second cache/internet throughput samples. */
export function getLiveHistory(includeAll = false): LivePoint[] {
  return modes()[includeAll ? "all" : "public"].history.slice();
}

/** Individual client downloads inside one group, fastest first (capped). */
export function getGroupDownloads(key: string, includeAll = false): { downloads: LiveDownload[]; total: number } {
  const rows = modes()[includeAll ? "all" : "public"].downloads.filter((d) => groupKey(d.service, d.gameName) === key);
  return { downloads: rows.slice(0, DETAIL_CAP), total: rows.length };
}
