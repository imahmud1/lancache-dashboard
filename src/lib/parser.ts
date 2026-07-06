import { getDb } from "./db";
import fs from "fs";
import { StringDecoder } from "string_decoder";

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

    case "epicgames": {
      // Epic download paths look like /Builds/{ArtifactName}/CloudDir/...
      // The artifact name is Epic's app identifier (e.g. Fortnite, UnrealEngineLauncher).
      const epicMatch = requestPath.match(/\/Builds\/([^/]+)\//i);
      return epicMatch ? epicMatch[1] : null;
    }

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

  // Read in large binary chunks and split lines ourselves. Using readline's
  // per-line async iterator over tens of millions of lines creates one promise
  // per line, which overflows Node's async-hooks tracking in Next dev
  // ("RangeError: Map maximum size exceeded"). One await per chunk keeps it bounded.
  const fileStream = fs.createReadStream(logPath, {
    start: startPosition,
    highWaterMark: 1 << 22, // 4 MB chunks
  });
  const decoder = new StringDecoder("utf-8");

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

  // The rollups are additive upserts, so the parse cursor must advance in the
  // SAME transaction that writes each batch. Otherwise a crash, restart, or
  // overlapping ingest between a committed batch and the cursor write would make
  // the next run re-read that span and double-count it. Committing rows + cursor
  // atomically makes ingestion idempotent per batch, so a resumed run continues
  // exactly after the last committed batch — no gap, no overlap.
  const flushBatch = (positionAfterBatch: number) => {
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

      // Advance the cursor together with the rows this batch just wrote.
      updateState.run(positionAfterBatch, fileSize);
    });

    insertBatch(batch);
    batch = [];
  };

  let bytesRead = startPosition;
  let leftover = "";
  let stopped = false;

  // Process one raw line (without its trailing newline). Returns true when the
  // maxLines limit is reached and parsing should stop.
  const consumeLine = (raw: string): boolean => {
    // Count raw bytes + the newline delimiter. Keeping any trailing \r in the
    // byte count (CRLF logs) keeps the cursor exact; it's stripped before parsing.
    bytesRead += Buffer.byteLength(raw, "utf-8") + 1;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const entry = parseLine(line);
    if (entry) {
      batch.push(entry);
      lineCount++;
      if (batch.length >= BATCH_SIZE) {
        flushBatch(bytesRead);
        if (onProgress) onProgress({ lines: lineCount, bytesRead, totalBytes: fileSize });
      }
      if (maxLines && lineCount >= maxLines) return true;
    }
    return false;
  };

  for await (const chunk of fileStream) {
    const text = leftover + decoder.write(chunk as Buffer);
    let start = 0;
    let nl = text.indexOf("\n");
    while (nl !== -1) {
      if (consumeLine(text.slice(start, nl))) {
        stopped = true;
        break;
      }
      start = nl + 1;
      nl = text.indexOf("\n", start);
    }
    leftover = text.slice(start);
    if (stopped) break;
  }

  // Handle a final line without a trailing newline (full read only).
  if (!stopped) {
    leftover += decoder.end();
    if (leftover.length > 0) consumeLine(leftover);
  }

  // Flush remaining (also advances the cursor atomically with these rows)
  flushBatch(bytesRead);

  // Trim recent_activity to last 1000 entries
  db.prepare(`
    DELETE FROM recent_activity WHERE id NOT IN (
      SELECT id FROM recent_activity ORDER BY id DESC LIMIT 1000
    )
  `).run();

  // Snap the cursor to everything consumed. This covers the case where the final
  // batch was empty (e.g. trailing non-parseable lines after the last full batch)
  // so the cursor can't be left short. bytesRead is the offset just past the last
  // consumed line, so a resume continues exactly here regardless of how the
  // previous run ended.
  updateState.run(bytesRead, fileSize);

  return lineCount;
}
