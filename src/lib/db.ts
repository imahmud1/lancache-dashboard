import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "..", "data", "lancache.db");

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -64000"); // 64MB cache
    db.pragma("busy_timeout = 5000");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hourly_stats (
      hour TEXT NOT NULL,          -- ISO format: 2026-06-09T00
      service TEXT NOT NULL,
      client_ip TEXT NOT NULL,
      requests INTEGER DEFAULT 0,
      bytes_sent INTEGER DEFAULT 0,
      cache_hits INTEGER DEFAULT 0,
      cache_misses INTEGER DEFAULT 0,
      hit_bytes INTEGER DEFAULT 0,
      miss_bytes INTEGER DEFAULT 0,
      PRIMARY KEY (hour, service, client_ip)
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      day TEXT NOT NULL,           -- ISO format: 2026-06-09
      service TEXT NOT NULL,
      client_ip TEXT NOT NULL,
      requests INTEGER DEFAULT 0,
      bytes_sent INTEGER DEFAULT 0,
      cache_hits INTEGER DEFAULT 0,
      cache_misses INTEGER DEFAULT 0,
      hit_bytes INTEGER DEFAULT 0,
      miss_bytes INTEGER DEFAULT 0,
      PRIMARY KEY (day, service, client_ip)
    );

    CREATE TABLE IF NOT EXISTS recent_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      service TEXT NOT NULL,
      client_ip TEXT NOT NULL,
      request_path TEXT NOT NULL,
      bytes_sent INTEGER DEFAULT 0,
      cache_status TEXT,
      upstream_host TEXT
    );

    CREATE TABLE IF NOT EXISTS parse_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_position INTEGER DEFAULT 0,
      last_file_size INTEGER DEFAULT 0,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_hourly_service ON hourly_stats(service);
    CREATE INDEX IF NOT EXISTS idx_hourly_hour ON hourly_stats(hour);
    CREATE INDEX IF NOT EXISTS idx_daily_service ON daily_stats(service);
    CREATE INDEX IF NOT EXISTS idx_daily_day ON daily_stats(day);
    CREATE INDEX IF NOT EXISTS idx_recent_timestamp ON recent_activity(timestamp);
    CREATE INDEX IF NOT EXISTS idx_recent_service ON recent_activity(service);

    -- Track games/depots seen in cache
    CREATE TABLE IF NOT EXISTS cached_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      game_id TEXT NOT NULL,         -- depot ID for steam, or domain/path pattern for others
      game_name TEXT DEFAULT '',     -- resolved name (empty until resolved)
      image_url TEXT DEFAULT '',     -- cover/header image URL
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      total_bytes INTEGER DEFAULT 0,
      hit_count INTEGER DEFAULT 0,
      miss_count INTEGER DEFAULT 0,
      UNIQUE(service, game_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cached_games_service ON cached_games(service);
    CREATE INDEX IF NOT EXISTS idx_cached_games_bytes ON cached_games(total_bytes DESC);

    -- Shared, named absolute time-range presets (e.g. a LAN event's opening hours).
    -- start/end are hour strings (YYYY-MM-DDTHH) in log-local wall-clock; end is exclusive.
    CREATE TABLE IF NOT EXISTS saved_ranges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Initialize parse state if not exists
    INSERT OR IGNORE INTO parse_state (id, last_position, last_file_size, updated_at)
    VALUES (1, 0, 0, datetime('now'));
  `);
}
