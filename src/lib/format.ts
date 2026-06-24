export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i > 2 ? 2 : 0)} ${units[i]}`;
}

// Reports a byte/sec rate in bits/sec, using a 1024 base to mirror formatBytes.
export function formatBits(bytesPerSec: number): string {
  const bits = bytesPerSec * 8;
  if (bits === 0) return "0 bps";
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps", "Pbps"];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bits) / Math.log(k)), units.length - 1);
  const value = bits / Math.pow(k, i);
  return `${value.toFixed(i > 2 ? 2 : 0)} ${units[i]}`;
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// Service metadata lives in services.ts (full cache-domains coverage + fallback).
export { getServiceLabel, getServiceColor, getServiceAbbr, getServiceMeta } from "./services";
