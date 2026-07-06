// Shared, module-level progress state for long-running operations.
// Next.js route modules are singletons in the running server, so these
// objects are shared across requests within the same process.

export interface IngestProgress {
  running: boolean;
  error: boolean;
  lines: number;
  bytesRead: number;
  totalBytes: number;
  startedAt: number;
  finishedAt: number;
  message: string;
}

export interface DepotProgress {
  running: boolean;
  phase: "idle" | "checking" | "downloading" | "parsing" | "applying" | "done" | "error";
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  mappings: number;
  startedAt: number;
  finishedAt: number;
  message: string;
}

export const ingestProgress: IngestProgress = {
  running: false,
  error: false,
  lines: 0,
  bytesRead: 0,
  totalBytes: 0,
  startedAt: 0,
  finishedAt: 0,
  message: "",
};

export const depotProgress: DepotProgress = {
  running: false,
  phase: "idle",
  downloadedBytes: 0,
  totalBytes: 0,
  speedBps: 0,
  mappings: 0,
  startedAt: 0,
  finishedAt: 0,
  message: "",
};

// ---- Ingest lock (shared between manual ingest and auto-ingest) ----
let ingestRunning = false;

export function tryAcquireIngest(): boolean {
  if (ingestRunning) return false;
  ingestRunning = true;
  return true;
}

export function releaseIngest(): void {
  ingestRunning = false;
}
