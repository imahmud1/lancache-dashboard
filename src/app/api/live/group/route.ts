import { NextRequest, NextResponse } from "next/server";
import { getGroupDownloads } from "@/lib/live-tracker";
import { getHostnames } from "@/lib/hostnames";

export const dynamic = "force-dynamic";

/** Per-client downloads inside one live group (opened when a viewer expands a game). */
export function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!key || key.length > 300) return NextResponse.json({ error: "key required" }, { status: 400 });
  const includeAll = req.nextUrl.searchParams.get("includeAll") === "1";

  const { downloads, total } = getGroupDownloads(key, includeAll);
  const names = getHostnames(downloads.map((d) => d.clientIp));
  return NextResponse.json({
    total,
    downloads: downloads.map((d) => ({ ...d, hostname: names[d.clientIp] ?? null })),
  });
}
