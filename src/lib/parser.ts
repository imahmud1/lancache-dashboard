import { getDb } from "./db";
import fs from "fs";
import readline from "readline";

export interface ParsedLogEntry {
  service: string;
  clientIp: string;
  timestamp: string;
  hour: string;
  day: string;
  method: string;
  path: string;
  status: number;
  bytesSent: number;
  cacheStatus: string; // HIT, MISS, or "-"
  upstreamHost: string;
}

// Log format:
// [service] client_ip / - - - [09/Jun/2026:00:49:34 +0600] "GET /path HTTP/1.1" 200 1032272 "-" "User-Agent" "HIT/MISS" "upstream_host" "-"
const LOG_REGEX =
  /^\[(\w+)\]\s+([\d.]+)\s+\/\s+-\s+-\s+-\s+\[([^\]]+)\]\s+"(\w+)\s+([^"]+)\s+HTTP\/[\d.]+"\s+(\d+)\s+(\d+)\s+"[^"]*"\s+"[^"]*"\s+"([^"]*)"\s+"([^"]*)"/;

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04",
  May: "05", Jun: "06", Jul: "07", Aug: "08",
  Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseTimestamp(raw: string): { timestamp: string; hour: string; day: string } {
  // Format: 09/Jun/2026:00:49:34 +0600
  const match = raw.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    return { timestamp: raw, hour: "unknown", day: "unknown" };
  }
  const [, dd, mon, yyyy, hh, mm, ss] = match;
  const month = MONTH_MAP[mon] || "01";
  const timestamp = `${yyyy}-${month}-${dd}T${hh}:${mm}:${ss}`;
  const hour = `${yyyy}-${month}-${dd}T${hh}`;
  const day = `${yyyy}-${month}-${dd}`;
  return { timestamp, hour, day };
}

/**
 * Extract a game/content identifier from the request path based on service.
 * Returns null if no identifiable game can be determined.
 */
export function extractGameId(service: string, requestPath: string, upstreamHost?: string): string | null {
  switch (service.toLowerCase()) {
    case "steam":
      // Steam: /depot/DEPOT_ID/chunk/... or /depot/DEPOT_ID/manifest/...
      const steamMatch = requestPath.match(/\/depot\/(\d+)\//);
      return steamMatch ? steamMatch[1] : null;

    case "blizzard": {
      // Battle.net: product from upstream host (cod-assets.cdn.blizzard.com → "cod")
      // or /tpr/{product}/ path structure
      if (upstreamHost) {
        const hostMatch = upstreamHost.match(/^([a-z0-9_]+?)(?:-assets)?\.cdn\.blizzard\.com$/i);
        if (hostMatch) return hostMatch[1].toLowerCase();
      }
      const bnetPathMatch = requestPath.match(/\/tpr\/(\w+)\//);
      return bnetPathMatch ? bnetPathMatch[1] : null;
    }

    case "epicgames":
      // Epic: URLs contain app identifiers in some paths like /Builds/Fortnite/...
      const epicMatch = requestPath.match(/\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\//);
      return epicMatch ? `${epicMatch[1]}/${epicMatch[2]}` : null;

    case "riot":
      // Riot: often has game name in the domain or path
      const riotMatch = requestPath.match(/\/(valorant|lol|lor|bacon)\b/i);
      return riotMatch ? riotMatch[1].toLowerCase() : "riot-game";

    default:
      return null;
  }
}

export function parseLine(line: string): ParsedLogEntry | null {
  const match = line.match(LOG_REGEX);
  if (!match) return null;

  const [, service, clientIp, rawTimestamp, method, reqPath, status, bytes, cacheStatus, upstreamHost] = match;
  const { timestamp, hour, day } = parseTimestamp(rawTimestamp);

  return {
    service,
    clientIp,
    timestamp,
    hour,
    day,
    method,
    path: reqPath,
    status: parseInt(status, 10),
    bytesSent: parseInt(bytes, 10),
    cacheStatus: cacheStatus || "-",
    upstreamHost: upstreamHost || "-",
  };
}

export interface ParseProgress {
  lines: number;
  bytesRead: number;
  totalBytes: number;
}

export async function parseLogFile(
  logPath: string,
  onProgress?: (p: ParseProgress) => void,
  maxLines?: number
): Promise<number> {
  const db = getDb();

  // Get current parse state
  const state = db.prepare("SELECT last_position, last_file_size FROM parse_state WHERE id = 1").get() as {
    last_position: number;
    last_file_size: number;
  } | undefined;

  const fileStats = fs.statSync(logPath);
  const fileSize = fileStats.size;

  let startPosition = state?.last_position || 0;

  // If file got smaller (rotated), start from beginning
  if (fileSize < (state?.last_file_size || 0)) {
    startPosition = 0;
  }

  // Nothing new to parse
  if (startPosition >= fileSize) {
    return 0;
  }

  const fileStream = fs.createReadStream(logPath, {
    start: startPosition,
    encoding: "utf-8",
  });

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  // Prepare statements
  const upsertHourly = db.prepare(`
    INSERT INTO hourly_stats (hour, service, client_ip, requests, bytes_sent, cache_hits, cache_misses, hit_bytes, miss_bytes)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(hour, service, client_ip) DO UPDATE SET
      requests = requests + 1,
      bytes_sent = bytes_sent + excluded.bytes_sent,
      cache_hits = cache_hits + excluded.cache_hits,
      cache_misses = cache_misses + excluded.cache_misses,
      hit_bytes = hit_bytes + excluded.hit_bytes,
      miss_bytes = miss_bytes + excluded.miss_bytes
  `);

  const upsertDaily = db.prepare(`
    INSERT INTO daily_stats (day, service, client_ip, requests, bytes_sent, cache_hits, cache_misses, hit_bytes, miss_bytes)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(day, service, client_ip) DO UPDATE SET
      requests = requests + 1,
      bytes_sent = bytes_sent + excluded.bytes_sent,
      cache_hits = cache_hits + excluded.cache_hits,
      cache_misses = cache_misses + excluded.cache_misses,
      hit_bytes = hit_bytes + excluded.hit_bytes,
      miss_bytes = miss_bytes + excluded.miss_bytes
  `);

  const insertRecent = db.prepare(`
    INSERT INTO recent_activity (timestamp, service, client_ip, request_path, bytes_sent, cache_status, upstream_host)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertCachedGame = db.prepare(`
    INSERT INTO cached_games (service, game_id, first_seen, last_seen, total_bytes, hit_count, miss_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(service, game_id) DO UPDATE SET
      last_seen = excluded.last_seen,
      total_bytes = total_bytes + excluded.total_bytes,
      hit_count = hit_count + excluded.hit_count,
      miss_count = miss_count + excluded.miss_count
  `);

  const updateState = db.prepare(`
    UPDATE parse_state SET last_position = ?, last_file_size = ?, updated_at = datetime('now') WHERE id = 1
  `);

  let lineCount = 0;
  let batch: ParsedLogEntry[] = [];
  const BATCH_SIZE = 10000;

  const flushBatch = () => {
    if (batch.length === 0) return;

    const insertBatch = db.transaction((entries: ParsedLogEntry[]) => {
      for (const entry of entries) {
        const isHit = entry.cacheStatus === "HIT" ? 1 : 0;
        const isMiss = entry.cacheStatus === "MISS" ? 1 : 0;
        const hitBytes = isHit ? entry.bytesSent : 0;
        const missBytes = isMiss ? entry.bytesSent : 0;

        upsertHourly.run(entry.hour, entry.service, entry.clientIp, entry.bytesSent, isHit, isMiss, hitBytes, missBytes);
        upsertDaily.run(entry.day, entry.service, entry.clientIp, entry.bytesSent, isHit, isMiss, hitBytes, missBytes);

        // Track game/content IDs
        const gameId = extractGameId(entry.service, entry.path, entry.upstreamHost);
        if (gameId) {
          upsertCachedGame.run(
            entry.service, gameId, entry.timestamp, entry.timestamp,
            entry.bytesSent, isHit, isMiss
          );
        }
      }

      // Only keep recent activity for the last entry batch (we'll trim later)
      const lastEntries = entries.slice(-50);
      for (const entry of lastEntries) {
        insertRecent.run(
          entry.timestamp, entry.service, entry.clientIp,
          entry.path, entry.bytesSent, entry.cacheStatus, entry.upstreamHost
        );
      }
    });

    insertBatch(batch);
    batch = [];
  };

  let bytesRead = startPosition;

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, "utf-8") + 1; // +1 for newline
    const entry = parseLine(line);
    if (entry) {
      batch.push(entry);
      lineCount++;

      if (batch.length >= BATCH_SIZE) {
        flushBatch();
        if (onProgress) onProgress({ lines: lineCount, bytesRead, totalBytes: fileSize });
      }

      // Stop if we hit the max lines limit (for chunked ingestion)
      if (maxLines && lineCount >= maxLines) {
        break;
      }
    }
  }

  // Flush remaining
  flushBatch();

  // Trim recent_activity to last 1000 entries
  db.prepare(`
    DELETE FROM recent_activity WHERE id NOT IN (
      SELECT id FROM recent_activity ORDER BY id DESC LIMIT 1000
    )
  `).run();

  // Update parse position — if we broke early, use bytes read; otherwise file end
  const finalPosition = (maxLines && lineCount >= maxLines) ? bytesRead : fileSize;
  updateState.run(finalPosition, fileSize);

  return lineCount;
}
