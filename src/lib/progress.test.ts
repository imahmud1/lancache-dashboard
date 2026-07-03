import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The ingest lock is what makes pressing "Ingest" (or "Reprocess") a second time
 * while one is already running a no-op — the route returns 409 when
 * tryAcquireIngest() fails. It's a module-level singleton shared between the
 * manual ingest route and the auto-ingest interval, so we reset the module
 * between tests to get a clean lock.
 */
describe("ingest lock", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("grants the lock to the first caller only", async () => {
    const { tryAcquireIngest } = await import("./progress");

    expect(tryAcquireIngest()).toBe(true); // first press starts ingest
    expect(tryAcquireIngest()).toBe(false); // second press is rejected (would 409)
    expect(tryAcquireIngest()).toBe(false);
  });

  it("re-grants the lock after release", async () => {
    const { tryAcquireIngest, releaseIngest } = await import("./progress");

    expect(tryAcquireIngest()).toBe(true);
    releaseIngest();
    expect(tryAcquireIngest()).toBe(true); // a fresh ingest can start once the last finished
  });

  it("is safe to release when not held", async () => {
    const { tryAcquireIngest, releaseIngest } = await import("./progress");

    releaseIngest(); // no-op, must not throw
    expect(tryAcquireIngest()).toBe(true);
  });
});
