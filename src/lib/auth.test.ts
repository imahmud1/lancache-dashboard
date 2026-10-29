import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { adminKey, isAuthRequired, checkAdmin } from "./auth";

/**
 * Auth gate for mutating endpoints (e.g. the ingest route). When ADMIN_API_KEY
 * is unset the dashboard runs "open" and every request is allowed; once a key is
 * configured, a request must present a matching key via x-api-key or a Bearer
 * Authorization header.
 */

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ingest", { method: "POST", headers });
}

beforeEach(() => {
  // Isolate from any ADMIN_PASSWORD in the developer's shell or .env.
  vi.stubEnv("ADMIN_PASSWORD", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("adminKey / isAuthRequired", () => {
  it("reports open mode when no key is configured", () => {
    vi.stubEnv("ADMIN_API_KEY", "");
    expect(adminKey()).toBeNull();
    expect(isAuthRequired()).toBe(false);
  });

  it("treats a whitespace-only key as unset", () => {
    vi.stubEnv("ADMIN_API_KEY", "   ");
    expect(adminKey()).toBeNull();
    expect(isAuthRequired()).toBe(false);
  });

  it("prefers ADMIN_PASSWORD and still accepts ADMIN_API_KEY", () => {
    vi.stubEnv("ADMIN_API_KEY", "legacy");
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(adminKey()).toBe("legacy");
    vi.stubEnv("ADMIN_PASSWORD", "newer");
    expect(adminKey()).toBe("newer");
    expect(checkAdmin(req({ "x-api-key": "newer" }))).toBe(true);
    expect(checkAdmin(req({ "x-api-key": "legacy" }))).toBe(false);
  });

  it("trims and reports a configured key", () => {
    vi.stubEnv("ADMIN_API_KEY", "  s3cret  ");
    expect(adminKey()).toBe("s3cret");
    expect(isAuthRequired()).toBe(true);
  });
});

describe("checkAdmin", () => {
  it("allows any request in open mode", () => {
    vi.stubEnv("ADMIN_API_KEY", "");
    expect(checkAdmin(req())).toBe(true);
  });

  it("accepts a matching x-api-key header", () => {
    vi.stubEnv("ADMIN_API_KEY", "s3cret");
    expect(checkAdmin(req({ "x-api-key": "s3cret" }))).toBe(true);
  });

  it("accepts a matching Bearer token", () => {
    vi.stubEnv("ADMIN_API_KEY", "s3cret");
    expect(checkAdmin(req({ authorization: "Bearer s3cret" }))).toBe(true);
  });

  it("rejects a wrong key", () => {
    vi.stubEnv("ADMIN_API_KEY", "s3cret");
    expect(checkAdmin(req({ "x-api-key": "nope" }))).toBe(false);
  });

  it("rejects a missing key when one is required", () => {
    vi.stubEnv("ADMIN_API_KEY", "s3cret");
    expect(checkAdmin(req())).toBe(false);
  });

  it("rejects a key of a different length (no timingSafeEqual throw)", () => {
    vi.stubEnv("ADMIN_API_KEY", "s3cret");
    expect(checkAdmin(req({ "x-api-key": "longer-wrong-key" }))).toBe(false);
  });
});
