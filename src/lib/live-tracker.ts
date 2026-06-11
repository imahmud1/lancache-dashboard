import fs from "fs";
import path from "path";
import { parseLine } from "./parser";
import { getExcludedIps, getGameByDepot } from "./queries";
import { extractDepotId } from "./steam-resolver";
import { resolveBattleNetGame, getBattleNetImageUrl } from "./battlenet-resolver";

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
  window: { bytes: number; ts: number }[];
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
  s.window.push({ bytes: entry.bytesSent, ts: now });
}

function tick() {
  const st = state();
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

/**
 * Snapshot of currently-active downloads with computed speed.
 * Excludes prefill/local IPs unless includeAll is true.
 */
export function getActiveDownloads(includeAll = false): { downloads: LiveDownload[]; totalBps: number; peakBps: number } {
  const st = state();
  const sessions = st.sessions;
  const now = Date.now();
  const excluded = includeAll ? [] : getExcludedIps();

  const isExcluded = (ip: string) => {
    for (const ex of excluded) {
      if (ex.endsWith(".") || ex.endsWith(":")) {
        if (ip.startsWith(ex)) return true;
      } else if (ip === ex) return true;
    }
    return false;
  };

  const downloads: LiveDownload[] = [];
  let totalBps = 0;

  for (const [key, s] of sessions) {
    // Prune fully stale sessions
    if (now - s.lastSeen > PRUNE_MS) {
      sessions.delete(key);
      continue;
    }
    // Only "active" ones are shown
    if (now - s.lastSeen > ACTIVE_MS) continue;
    if (isExcluded(s.clientIp)) continue;

    // Speed from sliding window
    s.window = s.window.filter((w) => now - w.ts <= SPEED_WINDOW_MS);
    const windowBytes = s.window.reduce((sum, w) => sum + w.bytes, 0);
    const speedBps = windowBytes / (SPEED_WINDOW_MS / 1000);
    totalBps += speedBps;

    downloads.push({
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
      speedBps,
    });
  }

  st.peakBps = Math.max(st.peakBps, totalBps);
  downloads.sort((a, b) => b.speedBps - a.speedBps);
  return { downloads, totalBps, peakBps: st.peakBps };
}
