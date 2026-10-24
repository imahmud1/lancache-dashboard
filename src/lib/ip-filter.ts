// Which client IPs are hidden from stats by default (the "Hiding prefill" toggle).
// Kept free of DB imports so the live tracker and API routes can share it.

const DEFAULT_EXCLUDE = "127.0.0.1,::1,172.,localhost";

function splitList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * IPs/prefixes excluded from stats unless the viewer chooses "Showing prefill".
 *
 * EXCLUDE_IPS replaces the default list (cache host / docker bridge / loopback).
 * PREFILL_IPS is *added* on top, so pointing it at a dedicated prefill
 * workstation doesn't silently drop the defaults. Entries ending in "." or ":"
 * are prefixes (e.g. "172." for the docker bridge).
 */
export function getExcludedIps(): string[] {
  const base = splitList(process.env.EXCLUDE_IPS ?? DEFAULT_EXCLUDE);
  const prefill = splitList(process.env.PREFILL_IPS ?? "");
  return Array.from(new Set([...base, ...prefill]));
}

export function isPrefixEntry(entry: string): boolean {
  return entry.endsWith(".") || entry.endsWith(":");
}

export function isExcludedIp(ip: string, list: string[] = getExcludedIps()): boolean {
  for (const entry of list) {
    if (isPrefixEntry(entry) ? ip.startsWith(entry) : ip === entry) return true;
  }
  return false;
}
