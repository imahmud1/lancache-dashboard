import dns from "dns";
import net from "net";
import { watchedJson } from "./data-file";

// Friendly client names for the Clients / Live / Recent views.
//
// Two sources, both optional:
//  1. data/client-names.json — a hand-edited { "192.168.1.175": "CHIKO-PC" } map.
//     Always wins, and is re-read when the file changes (no restart needed).
//  2. Reverse DNS (PTR), opt-in via RESOLVE_HOSTNAMES=true. Only useful when the
//     LAN's DHCP/DNS server registers client hostnames (pfSense/OPNsense, dnsmasq,
//     Windows DNS, etc). Lookups run in the background and never block a request:
//     the first response may lack a name, the next refresh picks it up.

const POSITIVE_TTL_MS = 60 * 60_000; // re-check found names hourly
const NEGATIVE_TTL_MS = 10 * 60_000; // retry misses after 10 minutes
const LOOKUP_TIMEOUT_MS = 2_000;
const MAX_INFLIGHT = 4;
const MAX_CACHE = 4_096;
const MAX_NAME_LEN = 64;

interface CacheEntry {
  name: string | null;
  expires: number;
}

interface ResolverState {
  cache: Map<string, CacheEntry>;
  queue: string[];
  queued: Set<string>;
  inflight: number;
  resolver: dns.promises.Resolver | null;
}

// On globalThis so every route bundle shares one cache (same reason as live-tracker).
const g = globalThis as unknown as { __lancacheHostnames?: ResolverState };

function state(): ResolverState {
  if (!g.__lancacheHostnames) {
    g.__lancacheHostnames = { cache: new Map(), queue: [], queued: new Set(), inflight: 0, resolver: null };
  }
  return g.__lancacheHostnames;
}

function parseNameMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("expected an object of ip -> name");
  const out: Record<string, string> = {};
  for (const [ip, name] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof name === "string" && name.trim()) out[ip.trim()] = name.trim().slice(0, MAX_NAME_LEN);
  }
  return out;
}

const manualNames = watchedJson("client-names.json", parseNameMap, {});

export function reverseDnsEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.RESOLVE_HOSTNAMES?.trim() ?? "");
}

/** "CHIKO-PC.lan." -> "CHIKO-PC". The LAN suffix adds noise in a narrow column. */
export function shortHostname(fqdn: string): string {
  const trimmed = fqdn.trim().replace(/\.$/, "");
  const first = trimmed.split(".")[0];
  return (first || trimmed).slice(0, MAX_NAME_LEN);
}

function remember(ip: string, name: string | null) {
  const { cache } = state();
  cache.delete(ip); // re-insert so Map order tracks recency for eviction
  cache.set(ip, { name, expires: Date.now() + (name ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function pump() {
  const st = state();
  while (st.inflight < MAX_INFLIGHT && st.queue.length > 0) {
    const ip = st.queue.shift()!;
    st.inflight++;
    if (!st.resolver) st.resolver = new dns.promises.Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 1 });
    st.resolver
      .reverse(ip)
      .then((names) => remember(ip, names[0] ? shortHostname(names[0]) : null))
      .catch(() => remember(ip, null))
      .finally(() => {
        st.inflight--;
        st.queued.delete(ip);
        pump();
      });
  }
}

function schedule(ip: string) {
  const st = state();
  if (st.queued.has(ip) || net.isIP(ip) === 0) return;
  st.queued.add(ip);
  st.queue.push(ip);
}

/**
 * Best-known names for the given IPs. Never waits on DNS: returns what is known
 * now (manual map, then cached PTR results) and queues lookups for the rest.
 */
export function getHostnames(ips: Iterable<string>): Record<string, string> {
  const manual = manualNames();
  const rdns = reverseDnsEnabled();
  const now = Date.now();
  const { cache } = state();
  const out: Record<string, string> = {};

  for (const ip of new Set(ips)) {
    if (manual[ip]) {
      out[ip] = manual[ip];
      continue;
    }
    if (!rdns) continue;
    const hit = cache.get(ip);
    if (hit?.name) out[ip] = hit.name; // serve stale while refreshing
    if (!hit || hit.expires <= now) schedule(ip);
  }

  if (rdns) pump();
  return out;
}
