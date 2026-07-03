import { NextResponse } from "next/server";
import { getServiceLabel } from "@/lib/services";

export const dynamic = "force-dynamic";

const BASE = "https://raw.githubusercontent.com/uklans/cache-domains/master";

interface ServiceEntry {
  key: string;
  label: string;
  description: string;
  domains: string[];
}

// Cache the aggregated result in memory (refresh daily)
let cache: { data: ServiceEntry[]; fetchedAt: number } | null = null;
const TTL = 1000 * 60 * 60 * 24;

async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.text();
}

function parseDomains(txt: string): string[] {
  return txt
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < TTL) {
    return NextResponse.json({ services: cache.data, cachedAt: cache.fetchedAt });
  }

  try {
    const index = JSON.parse(await fetchText("cache_domains.json"));
    const entries: { name: string; description: string; domain_files: string[] }[] = index.cache_domains || [];

    const results: ServiceEntry[] = [];
    for (const entry of entries) {
      const domains = new Set<string>();
      for (const file of entry.domain_files || []) {
        try {
          parseDomains(await fetchText(file)).forEach((d) => domains.add(d));
        } catch {
          // skip a file that fails; keep the rest
        }
      }
      if (domains.size > 0) {
        results.push({
          key: entry.name,
          label: getServiceLabel(entry.name),
          description: entry.description,
          domains: Array.from(domains),
        });
      }
    }

    cache = { data: results, fetchedAt: Date.now() };
    return NextResponse.json({ services: results, cachedAt: cache.fetchedAt });
  } catch (error) {
    console.error("[cache-domains] fetch failed:", error);
    // Serve stale cache if we have it
    if (cache) {
      return NextResponse.json({ services: cache.data, cachedAt: cache.fetchedAt, stale: true });
    }
    return NextResponse.json({ error: "Failed to fetch cache domains" }, { status: 502 });
  }
}
