import { NextRequest, NextResponse } from "next/server";
import { getRecentActivity, parseTimeRange } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const includeAll = sp.get("includeAll") === "1";
    const range = parseTimeRange(sp.get("start"), sp.get("end"));
    const recent = getRecentActivity(100, { includeAll, range });
    return NextResponse.json({ recent });
  } catch (error) {
    console.error("Error fetching recent activity:", error);
    return NextResponse.json({ error: "Failed to fetch recent activity" }, { status: 500 });
  }
}
