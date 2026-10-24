import { NextRequest, NextResponse } from "next/server";
import { getClientStats, parseTimeRange } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const includeAll = sp.get("includeAll") === "1";
    const range = parseTimeRange(sp.get("start"), sp.get("end"));
    const clients = getClientStats(50, { includeAll, range });
    return NextResponse.json({ clients });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}
