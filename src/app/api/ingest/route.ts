import { NextRequest, NextResponse } from "next/server";
import { parseLogFile } from "@/lib/parser";
import { getDb } from "@/lib/db";
import { ingestProgress, tryAcquireIngest, releaseIngest } from "@/lib/progress";
import { checkAdmin } from "@/lib/auth";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const LOG_PATH = process.env.LOG_PATH || path.join(process.cwd(), "..", "logs", "access.log");

async function runIngest(reprocess = false) {
  ingestProgress.running = true;
  ingestProgress.error = false;
  ingestProgress.lines = 0;
  ingestProgress.bytesRead = 0;
  ingestProgress.totalBytes = 0;
  ingestProgress.startedAt = Date.now();
  ingestProgress.finishedAt = 0;
  ingestProgress.message = reprocess ? "Rebuilding from log..." : "Starting...";

  try {
    // Rebuild: the rollups use additive upserts, so re-reading the log on top of
    // existing rows would double-count. Clear them first, then re-read the whole
    // file from the start. Note this only recovers what the current log still
    // contains — anything already rotated out is gone (guarded by a UI confirm).
    if (reprocess) {
      const db = getDb();
      const wipe = db.transaction(() => {
        db.prepare("DELETE FROM hourly_stats").run();
        db.prepare("DELETE FROM daily_stats").run();
        db.prepare("DELETE FROM cached_games").run();
        db.prepare("DELETE FROM recent_activity").run();
        db.prepare("UPDATE parse_state SET last_position = 0, last_file_size = 0 WHERE id = 1").run();
      });
      wipe();
    }

    try {
      ingestProgress.totalBytes = fs.statSync(LOG_PATH).size;
    } catch {
      /* ignore */
    }

    const lines = await parseLogFile(LOG_PATH, (p) => {
      ingestProgress.lines = p.lines;
      ingestProgress.bytesRead = p.bytesRead;
      ingestProgress.totalBytes = p.totalBytes;
      ingestProgress.message = `${reprocess ? "Rebuilding" : "Processing"}... ${p.lines.toLocaleString()} entries`;
    });

    ingestProgress.lines = Math.max(ingestProgress.lines, lines);
    ingestProgress.message = lines > 0
      ? `Done — ${lines.toLocaleString()} entries ${reprocess ? "rebuilt" : "ingested"}`
      : "Up to date — no new entries";
  } catch (err) {
    ingestProgress.error = true;
    ingestProgress.message = `Error: ${String(err)}`;
    console.error("[ingest] error:", err);
  } finally {
    ingestProgress.running = false;
    ingestProgress.finishedAt = Date.now();
    releaseIngest();
  }
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!tryAcquireIngest()) {
    return NextResponse.json({ message: "Ingestion already in progress", running: true }, { status: 409 });
  }
  const reprocess = req.nextUrl.searchParams.get("reprocess") === "1";
  void runIngest(reprocess);
  return NextResponse.json({ started: true, reprocess });
}

export function GET() {
  const pct =
    ingestProgress.totalBytes > 0
      ? Math.min(100, Math.round((ingestProgress.bytesRead / ingestProgress.totalBytes) * 100))
      : ingestProgress.running ? 0 : 100;

  return NextResponse.json({
    ...ingestProgress,
    percent: pct,
    logPath: LOG_PATH,
  });
}
