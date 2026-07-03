import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for the ingest / reprocess flow. Unlike parser.test.ts
 * (which unit-tests the pure parseLine/extractGameId), these drive parseLogFile
 * against a real in-memory SQLite DB to observe how the parse_state cursor and
 * the additive rollup upserts behave when ingest or reprocess is triggered on a
 * file whose contents have already been ingested.
 *
 * Each test gets a fresh module graph (vi.resetModules) so db.ts re-evaluates
 * with DB_PATH=":memory:", yielding an empty database.
 */

const buildLine = (o: {
  service?: string;
  ip?: string;
  ts?: string;
  path?: string;
  status?: number;
  bytes?: number;
  cache?: string;
  upstream?: string;
}) => {
  const {
    service = "steam",
    ip = "192.168.1.50",
    ts = "09/Jun/2026:00:49:34 +0000",
    path: reqPath = "/depot/1/chunk/a",
    status = 200,
    bytes = 100,
    cache = "HIT",
    upstream = "lancache.steamcontent.com",
  } = o;
  return `[${service}] ${ip} / - - - [${ts}] "GET ${reqPath} HTTP/1.1" ${status} ${bytes} "-" "UA" "${cache}" "${upstream}" "-"`;
};

// Three lines: two steam (depot 1, one HIT/100 + one MISS/200) and one epic (HIT/50).
const THREE_LINES = [
  buildLine({ cache: "HIT", bytes: 100, path: "/depot/1/chunk/a" }),
  buildLine({ cache: "MISS", bytes: 200, path: "/depot/1/chunk/b" }),
  buildLine({ service: "epicgames", ip: "192.168.1.51", bytes: 50, path: "/Builds/Fortnite/x/y", upstream: "epic" }),
];

let logPath: string;

async function loadModules() {
  const parser = await import("./parser");
  const { getDb } = await import("./db");
  return { parseLogFile: parser.parseLogFile, clearForReprocess: parser.clearForReprocess, db: getDb() };
}

function writeLog(lines: string[]) {
  fs.writeFileSync(logPath, lines.join("\n") + "\n");
}

const totals = (db: import("better-sqlite3").Database) =>
  db
    .prepare("SELECT COALESCE(SUM(requests),0) AS requests, COALESCE(SUM(bytes_sent),0) AS bytes FROM hourly_stats")
    .get() as { requests: number; bytes: number };

const state = (db: import("better-sqlite3").Database) =>
  db.prepare("SELECT last_position, last_file_size FROM parse_state WHERE id = 1").get() as {
    last_position: number;
    last_file_size: number;
  };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DB_PATH", ":memory:");
  logPath = path.join(os.tmpdir(), `lc-ingest-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  try {
    fs.unlinkSync(logPath);
  } catch {
    /* file may not exist */
  }
});

describe("first ingest", () => {
  it("aggregates every line and advances the cursor to end of file", async () => {
    writeLog(THREE_LINES);
    const { parseLogFile, db } = await loadModules();

    const lines = await parseLogFile(logPath);

    expect(lines).toBe(3);
    expect(totals(db)).toEqual({ requests: 3, bytes: 350 });
    const size = fs.statSync(logPath).size;
    expect(state(db)).toEqual({ last_position: size, last_file_size: size });
  });
});

describe("re-ingest when logs are already ingested", () => {
  it("is a no-op: returns 0 and leaves the rollups untouched", async () => {
    writeLog(THREE_LINES);
    const { parseLogFile, db } = await loadModules();

    await parseLogFile(logPath);
    const before = totals(db);

    // Pressing "ingest" again with no new lines in the file.
    const second = await parseLogFile(logPath);

    expect(second).toBe(0);
    expect(totals(db)).toEqual(before); // no double counting
  });

  it("processes only newly appended lines, not previously ingested ones", async () => {
    writeLog(THREE_LINES);
    const { parseLogFile, db } = await loadModules();

    await parseLogFile(logPath);
    expect(totals(db)).toEqual({ requests: 3, bytes: 350 });

    // Append one more line and ingest again.
    writeLog([...THREE_LINES, buildLine({ cache: "HIT", bytes: 25, path: "/depot/1/chunk/c" })]);
    const added = await parseLogFile(logPath);

    expect(added).toBe(1); // only the new line
    expect(totals(db)).toEqual({ requests: 4, bytes: 375 });
  });
});

describe("reprocess when logs are already ingested", () => {
  it("rebuilds totals from scratch instead of double-counting", async () => {
    // clearForReprocess() wipes the log-derived rollups and zeroes cached_games
    // counters before the full re-read, so reprocessing an already-ingested file
    // reproduces the original totals rather than stacking a second copy.
    writeLog(THREE_LINES);
    const { parseLogFile, clearForReprocess, db } = await loadModules();

    await parseLogFile(logPath);
    expect(totals(db)).toEqual({ requests: 3, bytes: 350 });

    clearForReprocess();
    const reprocessed = await parseLogFile(logPath);

    expect(reprocessed).toBe(3);
    expect(totals(db)).toEqual({ requests: 3, bytes: 350 }); // not doubled

    const steam = db
      .prepare("SELECT total_bytes, hit_count, miss_count FROM cached_games WHERE service = 'steam'")
      .get() as { total_bytes: number; hit_count: number; miss_count: number };
    expect(steam).toEqual({ total_bytes: 300, hit_count: 1, miss_count: 1 });
  });

  it("preserves resolved game_name/image_url across a reprocess", async () => {
    // Names/images are resolved out-of-band (depot refresh, PICS lookups) and are
    // expensive to rebuild, so reprocess must not discard them.
    writeLog(THREE_LINES);
    const { parseLogFile, clearForReprocess, db } = await loadModules();

    await parseLogFile(logPath);
    db.prepare(
      "UPDATE cached_games SET game_name = ?, image_url = ? WHERE service = 'steam' AND game_id = '1'"
    ).run("Half-Life 3", "https://img/hl3.jpg");

    clearForReprocess();
    await parseLogFile(logPath);

    const steam = db
      .prepare("SELECT game_name AS name, image_url AS img, total_bytes AS bytes FROM cached_games WHERE game_id = '1'")
      .get() as { name: string; img: string; bytes: number };
    expect(steam.name).toBe("Half-Life 3"); // resolved metadata survived
    expect(steam.img).toBe("https://img/hl3.jpg");
    expect(steam.bytes).toBe(300); // counters rebuilt cleanly, not doubled
  });
});

describe("chunked ingest (maxLines) resumes where it left off", () => {
  it("stops at the line cap, then a later ingest picks up the remainder without re-counting", async () => {
    writeLog(THREE_LINES);
    const { parseLogFile, db } = await loadModules();

    const firstChunk = await parseLogFile(logPath, undefined, 2);
    expect(firstChunk).toBe(2);
    expect(totals(db).requests).toBe(2);
    expect(state(db).last_position).toBeLessThan(fs.statSync(logPath).size);

    const secondChunk = await parseLogFile(logPath, undefined, 2);
    expect(secondChunk).toBe(1); // only the remaining line
    expect(totals(db)).toEqual({ requests: 3, bytes: 350 }); // no line counted twice
  });
});

describe("log rotation", () => {
  it("re-reads from the start when the file shrinks", async () => {
    writeLog(THREE_LINES);
    const { parseLogFile, db } = await loadModules();

    await parseLogFile(logPath);

    // Rotated: a smaller file replaces the old one.
    writeLog([buildLine({ cache: "HIT", bytes: 10, path: "/depot/2/chunk/a" })]);
    const afterRotate = await parseLogFile(logPath);

    // The single new line is read from position 0 (not skipped as "already past").
    expect(afterRotate).toBe(1);
    expect(state(db).last_position).toBe(fs.statSync(logPath).size);
  });
});
