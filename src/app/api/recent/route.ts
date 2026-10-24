import { NextRequest, NextResponse } from "next/server";
import { getRecentActivity, parseTimeRange } from "@/lib/queries";
import { getHostnames } from "@/lib/hostnames";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const includeAll = sp.get("includeAll") === "1";
    const range = parseTimeRange(sp.get("start"), sp.get("end"));
    const rows = getRecentActivity(100, { includeAll, range });
    const names = getHostnames(rows.map((r) => r.clientIp));
    const recent = rows.map((r) => ({ ...r, hostname: names[r.clientIp] ?? null }));
    return NextResponse.json({ recent });
  } catch (error) {
    console.error("Error fetching recent activity:", error);
    return NextResponse.json({ error: "Failed to fetch recent activity" }, { status: 500 });
  }
}
