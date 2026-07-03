import { describe, it, expect, vi } from "vitest";

// parser.ts imports ./db, which touches the filesystem at module load. parseLine
// and extractGameId never use the DB, so we stub it out to keep these pure.
vi.mock("./db", () => ({
  getDb: () => {
    throw new Error("getDb should not be called from parseLine/extractGameId");
  },
}));

import { parseLine, extractGameId } from "./parser";

const line = (fields: {
  service?: string;
  ip?: string;
  ts?: string;
  method?: string;
  path?: string;
  status?: number;
  bytes?: number;
  cache?: string;
  upstream?: string;
}) => {
  const {
    service = "steam",
    ip = "192.168.1.50",
    ts = "09/Jun/2026:00:49:34 +0600",
    method = "GET",
    path = "/depot/1234567/chunk/abc",
    status = 200,
    bytes = 1032272,
    cache = "HIT",
    upstream = "lancache.steamcontent.com",
  } = fields;
  return `[${service}] ${ip} / - - - [${ts}] "${method} ${path} HTTP/1.1" ${status} ${bytes} "-" "Steam HTTP Client 1.0" "${cache}" "${upstream}" "-"`;
};

describe("parseLine", () => {
  it("extracts all fields from a well-formed line", () => {
    const entry = parseLine(line({}));
    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      service: "steam",
      clientIp: "192.168.1.50",
      method: "GET",
      path: "/depot/1234567/chunk/abc",
      status: 200,
      bytesSent: 1032272,
      cacheStatus: "HIT",
      upstreamHost: "lancache.steamcontent.com",
    });
  });

  it("coerces status and bytes to numbers", () => {
    const entry = parseLine(line({ status: 206, bytes: 42 }))!;
    expect(entry.status).toBe(206);
    expect(entry.bytesSent).toBe(42);
    expect(typeof entry.status).toBe("number");
  });

  it("preserves MISS and '-' cache statuses", () => {
    expect(parseLine(line({ cache: "MISS" }))!.cacheStatus).toBe("MISS");
    expect(parseLine(line({ cache: "-" }))!.cacheStatus).toBe("-");
  });

  it("returns null for a non-matching line", () => {
    expect(parseLine("garbage line without structure")).toBeNull();
    expect(parseLine("")).toBeNull();
  });
});

describe("parseLine timestamp bucketing (UTC)", () => {
  it("shifts a positive offset back to UTC", () => {
    // 00:49:34 +0600 => local is UTC+6, so UTC is 6h earlier: previous day 18:49
    const entry = parseLine(line({ ts: "09/Jun/2026:00:49:34 +0600" }))!;
    expect(entry.timestamp).toBe("2026-06-08T18:49:34");
    expect(entry.hour).toBe("2026-06-08T18");
    expect(entry.day).toBe("2026-06-08");
  });

  it("shifts a negative offset forward to UTC", () => {
    // 20:00:00 -0500 => local is UTC-5, so UTC is 5h later: next day 01:00
    const entry = parseLine(line({ ts: "09/Jun/2026:20:00:00 -0500" }))!;
    expect(entry.timestamp).toBe("2026-06-10T01:00:00");
    expect(entry.hour).toBe("2026-06-10T01");
    expect(entry.day).toBe("2026-06-10");
  });

  it("assumes UTC when no offset is present", () => {
    const entry = parseLine(line({ ts: "09/Jun/2026:00:49:34" }))!;
    expect(entry.hour).toBe("2026-06-09T00");
  });
});

describe("extractGameId", () => {
  it("pulls the depot id from a steam path", () => {
    expect(extractGameId("steam", "/depot/1234567/chunk/abc")).toBe("1234567");
    expect(extractGameId("steam", "/depot/9/manifest/x")).toBe("9");
  });

  it("returns null for a steam path without a depot", () => {
    expect(extractGameId("steam", "/serverlist/foo")).toBeNull();
  });

  it("derives the blizzard product from the upstream host", () => {
    expect(extractGameId("blizzard", "/whatever", "cod-assets.cdn.blizzard.com")).toBe("cod");
    expect(extractGameId("blizzard", "/whatever", "pro.cdn.blizzard.com")).toBe("pro");
  });

  it("falls back to the blizzard /tpr/ path when no host matches", () => {
    expect(extractGameId("blizzard", "/tpr/wow/data/xx")).toBe("wow");
  });

  it("combines the first two epic path segments", () => {
    expect(extractGameId("epicgames", "/Builds/Fortnite/CloudDir/x")).toBe("Builds/Fortnite");
  });

  it("recognizes known riot games and defaults otherwise", () => {
    expect(extractGameId("riot", "/valorant/patch/x")).toBe("valorant");
    expect(extractGameId("riot", "/LoL/patch/x")).toBe("lol");
    expect(extractGameId("riot", "/unknown/path")).toBe("riot-game");
  });

  it("is case-insensitive on the service name", () => {
    expect(extractGameId("STEAM", "/depot/55/chunk/x")).toBe("55");
  });

  it("returns null for services without game extraction", () => {
    expect(extractGameId("wsus", "/some/path")).toBeNull();
  });
});
