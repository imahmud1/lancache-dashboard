import fs from "fs";
import path from "path";

/** Directory holding the DB, depot mappings, and optional operator JSON files. */
export function dataDir(): string {
  // turbopackIgnore: these are runtime paths, not files to trace into the bundle.
  return process.env.DB_PATH
    ? path.dirname(process.env.DB_PATH)
    : path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "data");
}

// Re-stat watched files at most this often, so per-request (or per-log-line)
// lookups stay a cheap timestamp compare.
const RECHECK_MS = 5_000;

/**
 * An optional, hand-edited JSON file in the data directory that is re-read
 * whenever it changes on disk. Lets operators edit names/overrides mid-event
 * without restarting the container. A missing file yields `fallback`; a
 * malformed file keeps the last good value and logs once per bad version.
 */
export function watchedJson<T>(fileName: string, parse: (raw: unknown) => T, fallback: T): () => T {
  let value = fallback;
  let lastMtime = -1;
  let lastCheck = 0;

  return () => {
    const now = Date.now();
    if (now - lastCheck < RECHECK_MS) return value;
    lastCheck = now;

    const file = path.join(/*turbopackIgnore: true*/ dataDir(), fileName);
    let mtime: number;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      value = fallback; // file removed or never created
      lastMtime = -1;
      return value;
    }
    if (mtime === lastMtime) return value;
    lastMtime = mtime;

    try {
      value = parse(JSON.parse(fs.readFileSync(file, "utf-8")));
    } catch (err) {
      console.error(`[data-file] Ignoring invalid ${fileName}:`, String(err));
    }
    return value;
  };
}
