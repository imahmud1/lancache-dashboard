import { describe, it, expect, afterEach, vi } from "vitest";
import {
  toHourString,
  hourToDate,
  floorToHour,
  hourToLocalInput,
  resolveSelection,
  formatHour,
  selectionLabel,
  rangeQuery,
  type RangeSelection,
} from "./range";

describe("toHourString / hourToDate", () => {
  it("formats a Date as a UTC hour string", () => {
    const d = new Date(Date.UTC(2026, 6, 1, 18, 30, 45)); // month is 0-indexed => Jul
    expect(toHourString(d)).toBe("2026-07-01T18");
  });

  it("zero-pads month, day, and hour", () => {
    const d = new Date(Date.UTC(2026, 0, 5, 3, 0, 0));
    expect(toHourString(d)).toBe("2026-01-05T03");
  });

  it("round-trips through hourToDate at the hour boundary", () => {
    const h = "2026-07-01T18";
    expect(toHourString(hourToDate(h))).toBe(h);
    expect(hourToDate(h).getTime()).toBe(Date.UTC(2026, 6, 1, 18));
  });
});

describe("floorToHour", () => {
  it("truncates a datetime-local value to its hour", () => {
    expect(floorToHour("2026-07-01T18:30")).toBe("2026-07-01T18");
  });
});

describe("hourToLocalInput", () => {
  it("appends :00 to make a datetime-local value", () => {
    expect(hourToLocalInput("2026-07-01T18")).toBe("2026-07-01T18:00");
  });
});

describe("resolveSelection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for all-time", () => {
    expect(resolveSelection({ kind: "all" })).toBeNull();
  });

  it("passes through custom bounds unchanged", () => {
    const sel: RangeSelection = { kind: "custom", start: "2026-07-01T00", end: "2026-07-02T00" };
    expect(resolveSelection(sel)).toEqual({ start: "2026-07-01T00", end: "2026-07-02T00" });
  });

  it("passes through saved bounds unchanged", () => {
    const sel: RangeSelection = { kind: "saved", id: 1, name: "LAN", start: "2026-07-01T00", end: "2026-07-03T00" };
    expect(resolveSelection(sel)).toEqual({ start: "2026-07-01T00", end: "2026-07-03T00" });
  });

  it("makes the relative end exclusive of the current partial hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 3, 14, 25, 0))); // 14:25 UTC
    const resolved = resolveSelection({ kind: "relative", hours: 6 });
    // end rounds up to the next hour boundary (15:00), start is 6h before that
    expect(resolved).toEqual({ start: "2026-07-03T09", end: "2026-07-03T15" });
  });

  it("handles a relative window that crosses a day boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 3, 1, 10, 0))); // 01:10 UTC
    const resolved = resolveSelection({ kind: "relative", hours: 6 });
    // end = 02:00 on the 3rd, start = 6h earlier = 20:00 on the 2nd
    expect(resolved).toEqual({ start: "2026-07-02T20", end: "2026-07-03T02" });
  });
});

describe("formatHour", () => {
  it("renders a human UTC label", () => {
    expect(formatHour("2026-07-01T18")).toBe("1 Jul, 18:00 UTC");
    expect(formatHour("2026-01-05T03")).toBe("5 Jan, 03:00 UTC");
  });
});

describe("selectionLabel", () => {
  it("labels all-time", () => {
    expect(selectionLabel({ kind: "all" })).toBe("All time");
  });

  it("uses the preset label for a known relative range", () => {
    expect(selectionLabel({ kind: "relative", hours: 24 })).toBe("Last 24h");
  });

  it("falls back to 'Last Nh' for an unknown relative range", () => {
    expect(selectionLabel({ kind: "relative", hours: 5 })).toBe("Last 5h");
  });

  it("uses the saved range's name", () => {
    expect(
      selectionLabel({ kind: "saved", id: 1, name: "LAN Friday", start: "2026-07-01T00", end: "2026-07-02T00" })
    ).toBe("LAN Friday");
  });

  it("renders both bounds for a custom range", () => {
    expect(selectionLabel({ kind: "custom", start: "2026-07-01T18", end: "2026-07-02T06" })).toBe(
      "1 Jul, 18:00 UTC → 2 Jul, 06:00 UTC"
    );
  });
});

describe("rangeQuery", () => {
  it("returns an empty string for all-time", () => {
    expect(rangeQuery(null)).toBe("");
  });

  it("builds an encoded start/end suffix", () => {
    expect(rangeQuery({ start: "2026-07-01T18", end: "2026-07-02T06" })).toBe(
      "&start=2026-07-01T18&end=2026-07-02T06"
    );
  });
});
