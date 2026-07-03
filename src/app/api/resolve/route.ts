import { NextRequest, NextResponse } from "next/server";
import { promises as dns } from "dns";

export const dynamic = "force-dynamic";

const WILDCARD = /^\*\./;

async function resolveHost(host: string): Promise<string[]> {
  const target = host.replace(WILDCARD, "lancachetest.");
  try {
    const ips = await dns.resolve4(target);
    if (ips.length) return ips;
  } catch {
    // fall through to lookup
  }
  try {
    const records = await dns.lookup(target, { all: true });
    return records.filter((r) => r.family === 4).map((r) => r.address);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  let hosts: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body.hosts)) hosts = body.hosts.slice(0, 200);
  } catch {
    return NextResponse.json({ results: {} });
  }

  const entries = await Promise.all(hosts.map(async (h) => [h, await resolveHost(h)] as const));
  return NextResponse.json({ results: Object.fromEntries(entries) });
}
