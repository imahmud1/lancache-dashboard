import { describe, it, expect } from "vitest";
import { formatBytes, formatBits, formatNumber, formatDuration } from "./format";

describe("formatBytes", () => {
  it("returns '0 B' for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("shows whole units without decimals below GB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("2 KB"); // 1.5 KB rounds via toFixed(0)
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
  });

  it("shows two decimals at GB and above", () => {
    expect(formatBytes(1024 ** 3)).toBe("1.00 GB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.50 GB");
    expect(formatBytes(1024 ** 4)).toBe("1.00 TB");
    expect(formatBytes(1024 ** 5)).toBe("1.00 PB");
  });
});

describe("formatBits", () => {
  it("returns '0 bps' for zero", () => {
    expect(formatBits(0)).toBe("0 bps");
  });

  it("converts bytes/sec to bits/sec with a 1024 base", () => {
    // 1024 B/s * 8 = 8192 bits = 8 Kbps
    expect(formatBits(1024)).toBe("8 Kbps");
    // 128 B/s * 8 = 1024 bits = 1 Kbps
    expect(formatBits(128)).toBe("1 Kbps");
  });

  it("shows whole numbers up to Mbps and two decimals from Gbps up", () => {
    // Decimals kick in above index 2 (Gbps), mirroring formatBytes' GB threshold.
    expect(formatBits((1024 ** 2) / 8)).toBe("1 Mbps");
    expect(formatBits((1024 ** 3) / 8)).toBe("1.00 Gbps");
    expect(formatBits((1024 ** 4) / 8)).toBe("1.00 Tbps");
  });

  it("clamps to the largest unit (Pbps) for huge values", () => {
    expect(formatBits(Number.MAX_SAFE_INTEGER)).toMatch(/Pbps$/);
  });
});

describe("formatNumber", () => {
  it("formats millions with an M suffix", () => {
    expect(formatNumber(1_000_000)).toBe("1.0M");
    expect(formatNumber(2_500_000)).toBe("2.5M");
  });

  it("formats thousands with a K suffix", () => {
    expect(formatNumber(1_000)).toBe("1.0K");
    expect(formatNumber(12_300)).toBe("12.3K");
  });

  it("uses locale grouping below 1000", () => {
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatDuration", () => {
  it("shows raw seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("shows minutes and seconds under an hour", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(600)).toBe("10m");
  });

  it("shows hours and minutes at or above an hour", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(3661)).toBe("1h 1m"); // seconds dropped once hours present
    expect(formatDuration(7320)).toBe("2h 2m");
  });
});
