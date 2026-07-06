import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { parseLogFile as ParseLogFile } from "./parser";
import type { getDb as GetDb } from "./db";

// Point the DB at a throwaway file BEFORE importing the modules that open it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lancache-test-"));
const DB_PATH = path.join(TMP, "test.db");
const LOG_PATH = path.join(TMP, "access.log");
process.env.DB_PATH = DB_PATH;

let parseLogFile: typeof ParseLogFile;
let getDb: typeof GetDb;

const SERVICES = ["steam", "epicgames", "blizzard", "riot"];
// ~60k lines (~8 MB) spans several 10k parser batches AND crosses the 4 MB
// read-chunk boundary, exercising the leftover-line splitting between chunks.
const LINE_COUNT = 60_000;

function buildLog(): { expectedBytes: number; expectedRequests: number } {
  const lines: string[] = [];
  let expectedBytes = 0;
  for (let i = 0; i < LINE_COUNT; i++) {
    const service = SERVICES[i % SERVICES.length];
    const client = `10.0.0.${(i % 20) + 1}`;
    const bytes = 1000 + (i % 5000);
    const hh = String(i % 24).padStart(2, "0");
    const cache = i % 3 === 0 ? "HIT" : "MISS";
    expectedBytes += bytes;
    lines.push(
      `[${service}] ${client} / - - - [09/Jun/2026:${hh}:00:00 +0000] ` +
        `"GET /depot/${1000 + (i % 50)}/chunk/${i} HTTP/1.1" 200 ${bytes} ` +
        `"-" "TestAgent" "${cache}" "cdn.example.com" "-"`
    );
  }
  fs.writeFileSync(LOG_PATH, lines.join("\n") + "\n");
  return { expectedBytes, expectedRequests: LINE_COUNT };
}

function totals() {
  const db = getDb();
  const row = db
    .prepare("SELECT COALESCE(SUM(requests),0) AS requests, COALESCE(SUM(bytes_sent),0) AS bytes FROM daily_stats")
    .get() as { requests: number; bytes: number };
  const cursor = (db.prepare("SELECT last_position FROM parse_state WHERE id = 1").get() as { last_position: number })
    .last_position;
  return { ...row, cursor };
}

function wipe() {
  const db = getDb();
  db.exec("DELETE FROM hourly_stats; DELETE FROM daily_stats; DELETE FROM cached_games; DELETE FROM recent_activity;");
  db.prepare("UPDATE parse_state SET last_position = 0, last_file_size = 0 WHERE id = 1").run();
}

beforeAll(async () => {
  ({ parseLogFile } = await import("./parser"));
  ({ getDb } = await import("./db"));
});

afterAll(() => {
  try {
    getDb().close();
  } catch {
    /* ignore */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("log ingestion resume", () => {
  it("an interrupted + resumed ingest equals a single uninterrupted pass", async () => {
    const { expectedBytes, expectedRequests } = buildLog();
    const fileSize = fs.statSync(LOG_PATH).size;

    // Baseline: one clean pass.
    wipe();
    await parseLogFile(LOG_PATH);
    const truth = totals();
    expect(truth.requests).toBe(expectedRequests);
    expect(truth.bytes).toBe(expectedBytes);
    expect(truth.cursor).toBe(fileSize);

    // Interrupted run: throw right after the first committed batch to simulate
    // a crash/restart/redeploy between a batch write and the end of the run.
    wipe();
    let crashed = false;
    await expect(
      parseLogFile(LOG_PATH, () => {
        if (!crashed) {
          crashed = true;
          throw new Error("simulated crash");
        }
      })
    ).rejects.toThrow("simulated crash");

    const afterCrash = totals();
    expect(afterCrash.requests).toBeGreaterThan(0); // a batch committed
    expect(afterCrash.requests).toBeLessThan(expectedRequests); // run didn't finish
    expect(afterCrash.cursor).toBeGreaterThan(0); // cursor advanced with the batch

    // Resume to completion: must match the clean pass exactly.
    await parseLogFile(LOG_PATH);
    const resumed = totals();
    expect(resumed.requests).toBe(expectedRequests); // no double-count, no gap
    expect(resumed.bytes).toBe(expectedBytes);
    expect(resumed.cursor).toBe(fileSize);
  });
});
