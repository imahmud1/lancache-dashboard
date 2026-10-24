import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for the ingest endpoint. The parser is mocked so we exercise
 * the HTTP wiring — admin auth, the shared ingest lock (409), and the reprocess
 * branch — without touching the filesystem or a real DB. runIngest is dispatched
 * fire-and-forget (`void runIngest(...)`), so we vi.waitFor the mocked parser to
 * observe that dispatch settled.
 */

const { parseLogFileMock, clearForReprocessMock } = vi.hoisted(() => ({
  parseLogFileMock: vi.fn(async () => 0),
  clearForReprocessMock: vi.fn(),
}));

vi.mock("@/lib/parser", () => ({
  parseLogFile: parseLogFileMock,
  clearForReprocess: clearForReprocessMock,
}));

function post(query = ""): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/ingest${query}`), { method: "POST" });
}

// Each test re-imports the route (and its progress lock) from a fresh module graph.
async function loadRoute() {
  return import("./route");
}

beforeEach(() => {
  vi.resetModules();
  parseLogFileMock.mockClear();
  clearForReprocessMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/ingest — auth", () => {
  it("returns 401 when a key is required but none is provided", async () => {
    vi.stubEnv("ADMIN_API_KEY", "s3cret");
    const { POST } = await loadRoute();

    const res = await POST(post());

    expect(res.status).toBe(401);
    expect(parseLogFileMock).not.toHaveBeenCalled();
  });

  it("starts an ingest in open mode (no key configured)", async () => {
    vi.stubEnv("ADMIN_API_KEY", "");
    const { POST } = await loadRoute();

    const res = await POST(post());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ started: true, reprocess: false });
    await vi.waitFor(() => expect(parseLogFileMock).toHaveBeenCalledTimes(1));
    expect(clearForReprocessMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ingest — reprocess", () => {
  it("wires reprocess=1 through to clearForReprocess before parsing", async () => {
    vi.stubEnv("ADMIN_API_KEY", "");
    const { POST } = await loadRoute();

    const res = await POST(post("?reprocess=1"));

    expect(await res.json()).toMatchObject({ started: true, reprocess: true });
    await vi.waitFor(() => {
      expect(clearForReprocessMock).toHaveBeenCalledTimes(1);
      expect(parseLogFileMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("POST /api/ingest — lock", () => {
  it("returns 409 and does not start a second run while one is in progress", async () => {
    vi.stubEnv("ADMIN_API_KEY", "");
    const { POST } = await loadRoute();
    const { tryAcquireIngest } = await import("@/lib/progress");

    // Simulate an ingest already holding the shared lock.
    expect(tryAcquireIngest()).toBe(true);

    const res = await POST(post());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ running: true });
    expect(parseLogFileMock).not.toHaveBeenCalled();
    expect(clearForReprocessMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/ingest — progress", () => {
  it("reports current progress with a computed percent and log path", async () => {
    const { GET } = await loadRoute();

    const body = await GET().json();

    expect(body).toHaveProperty("percent");
    expect(body).toHaveProperty("logPath");
    expect(body).toHaveProperty("running");
  });
});
