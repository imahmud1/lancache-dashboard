import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The auto-ingest interval shares the ingest lock with the manual route, so a
 * scheduled run must yield when a manual ingest is already holding it (otherwise
 * two concurrent readers of the same log could inflate totals). These tests mock
 * the parser and use fake timers to drive the scheduler without real I/O or a
 * 60-second wait.
 */

const { parseLogFileMock } = vi.hoisted(() => ({
  parseLogFileMock: vi.fn(async () => 0),
}));

vi.mock("./parser", () => ({
  parseLogFile: parseLogFileMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  parseLogFileMock.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("auto-ingest scheduling", () => {
  it("runs an immediate ingest on start when the lock is free", async () => {
    const { startAutoIngest, stopAutoIngest } = await import("./auto-ingest");

    startAutoIngest();

    // The immediate ingestOnce() reaches parseLogFile synchronously before yielding.
    expect(parseLogFileMock).toHaveBeenCalledTimes(1);
    stopAutoIngest();
  });

  it("yields (no parse) when a manual ingest already holds the lock", async () => {
    const { tryAcquireIngest } = await import("./progress");
    const { startAutoIngest, stopAutoIngest } = await import("./auto-ingest");

    expect(tryAcquireIngest()).toBe(true); // manual ingest holds the lock

    startAutoIngest();

    expect(parseLogFileMock).not.toHaveBeenCalled(); // auto run backed off
    stopAutoIngest();
  });

  it("is idempotent: a second start does not schedule a second interval", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { startAutoIngest, stopAutoIngest } = await import("./auto-ingest");

    startAutoIngest();
    startAutoIngest();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    stopAutoIngest();
  });

  it("stops the interval so no further runs fire", async () => {
    const { startAutoIngest, stopAutoIngest } = await import("./auto-ingest");

    startAutoIngest(); // immediate run #1
    expect(parseLogFileMock).toHaveBeenCalledTimes(1);

    stopAutoIngest();
    vi.advanceTimersByTime(180_000); // 3 intervals worth

    expect(parseLogFileMock).toHaveBeenCalledTimes(1); // nothing fired after stop
  });
});
