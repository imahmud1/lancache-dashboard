import { NextRequest, NextResponse } from "next/server";
import { getOverviewStats, getServiceStats, getBandwidthSeries, parseTimeRange } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const includeAll = sp.get("includeAll") === "1";
    const range = parseTimeRange(sp.get("start"), sp.get("end"));
    const opts = { includeAll, range };

    const overview = getOverviewStats(opts);
    const services = getServiceStats(20, opts);
    const { granularity, points } = getBandwidthSeries(opts);

    return NextResponse.json({
      overview,
      services,
      bandwidth: points,
      bandwidthGranularity: granularity,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
