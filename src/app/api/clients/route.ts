import { NextRequest, NextResponse } from "next/server";
import { getClientStats, parseTimeRange } from "@/lib/queries";
import { getExcludedIps, isExcludedIp } from "@/lib/ip-filter";
import { getHostnames } from "@/lib/hostnames";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const includeAll = sp.get("includeAll") === "1";
    const range = parseTimeRange(sp.get("start"), sp.get("end"));
    const rows = getClientStats(50, { includeAll, range });
    const excludedList = getExcludedIps();
    const names = getHostnames(rows.map((c) => c.clientIp));
    const clients = rows.map((c) => ({
      ...c,
      hostname: names[c.clientIp] ?? null,
      excluded: isExcludedIp(c.clientIp, excludedList),
    }));
    return NextResponse.json({ clients });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}
