import { describe, it, expect } from "vitest";
import { getServiceMeta, getServiceLabel, getServiceColor, getServiceAbbr } from "./services";

// Kept in sync with FALLBACK_PALETTE in services.ts.
const FALLBACK_PALETTE = [
  "#3b82f6", "#a855f7", "#10b981", "#f59e0b", "#ec4899",
  "#06b6d4", "#84cc16", "#f97316", "#6366f1", "#ef4444",
];

describe("getServiceMeta (known services)", () => {
  it("returns the registered metadata", () => {
    expect(getServiceMeta("steam")).toEqual({ label: "Steam", color: "#66c0f4", abbr: "STM" });
  });

  it("looks up case-insensitively", () => {
    expect(getServiceMeta("STEAM")).toEqual(getServiceMeta("steam"));
    expect(getServiceMeta("Blizzard").label).toBe("Battle.net");
  });
});

describe("getServiceMeta (unknown services / fallback)", () => {
  it("capitalizes the first letter for the label", () => {
    expect(getServiceMeta("mystery").label).toBe("Mystery");
  });

  it("uses the first three characters uppercased as the abbreviation", () => {
    expect(getServiceMeta("mystery").abbr).toBe("MYS");
  });

  it("picks a color from the fallback palette", () => {
    expect(FALLBACK_PALETTE).toContain(getServiceMeta("mystery").color);
  });

  it("is deterministic for the same service", () => {
    expect(getServiceMeta("mystery").color).toBe(getServiceMeta("mystery").color);
  });

  it("normalizes case before hashing the color", () => {
    expect(getServiceMeta("Mystery").color).toBe(getServiceMeta("mystery").color);
  });
});

describe("convenience accessors", () => {
  it("getServiceLabel returns the label", () => {
    expect(getServiceLabel("riot")).toBe("Riot Games");
  });

  it("getServiceColor returns the color", () => {
    expect(getServiceColor("riot")).toBe("#d13639");
  });

  it("getServiceAbbr returns the abbreviation", () => {
    expect(getServiceAbbr("riot")).toBe("RGT");
  });
});
