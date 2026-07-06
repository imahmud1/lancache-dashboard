import { parseLogFile } from "./parser";
import { tryAcquireIngest, releaseIngest, ingestProgress } from "./progress";
import path from "path";

const LOG_PATH = process.env.LOG_PATH || path.join(process.cwd(), "..", "logs", "access.log");
const INTERVAL_MS = 60_000; // Parse new entries every 60 seconds

let intervalId: ReturnType<typeof setInterval> | null = null;

async function ingestOnce() {
  // Shared lock prevents collision with a manual ingest
  if (!tryAcquireIngest()) return;
  // Keep the shared progress truthful so a manual trigger during an auto run
  // sees an accurate state (running + fresh result) instead of a stale message.
  ingestProgress.running = true;
  ingestProgress.error = false;
  ingestProgress.startedAt = Date.now();
  ingestProgress.finishedAt = 0;
  ingestProgress.message = "Auto-ingesting new entries...";
  try {
    // Process up to 500K lines per cycle to avoid blocking for too long
    const lines = await parseLogFile(
      LOG_PATH,
      (p) => {
        ingestProgress.lines = p.lines;
        ingestProgress.bytesRead = p.bytesRead;
        ingestProgress.totalBytes = p.totalBytes;
      },
      500_000
    );
    ingestProgress.lines = Math.max(ingestProgress.lines, lines);
    ingestProgress.message = lines > 0
      ? `Done — ${lines.toLocaleString()} entries ingested`
      : "Up to date — no new entries";
    if (lines > 0) {
      console.log(`[auto-ingest] Parsed ${lines.toLocaleString()} new log entries`);
    }
  } catch (err) {
    ingestProgress.error = true;
    ingestProgress.message = `Error: ${String(err)}`;
    console.error("[auto-ingest] Error:", err);
  } finally {
    ingestProgress.running = false;
    ingestProgress.finishedAt = Date.now();
    releaseIngest();
  }
}

export function startAutoIngest() {
  if (intervalId) return; // Already running

  console.log(`[auto-ingest] Starting automatic log ingestion every ${INTERVAL_MS / 1000}s`);
  console.log(`[auto-ingest] Log path: ${LOG_PATH}`);

  // Run immediately on start
  ingestOnce();

  // Then run on interval
  intervalId = setInterval(ingestOnce, INTERVAL_MS);
}

export function stopAutoIngest() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[auto-ingest] Stopped");
  }
}
