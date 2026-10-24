import { NextRequest, NextResponse } from "next/server";
import { listSavedRanges, createSavedRange, deleteSavedRange, parseTimeRange } from "@/lib/queries";
import { checkAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ranges: listSavedRanges() });
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { name?: unknown; start?: unknown; end?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const start = typeof body.start === "string" ? body.start : null;
  const end = typeof body.end === "string" ? body.end : null;
  const range = parseTimeRange(start, end);
  if (!name || !range) {
    return NextResponse.json({ error: "name, start and end (YYYY-MM-DDTHH, end > start) are required" }, { status: 400 });
  }
  const saved = createSavedRange(name.slice(0, 80), range.start, range.end);
  return NextResponse.json({ range: saved }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "valid id required" }, { status: 400 });
  }
  const removed = deleteSavedRange(id);
  if (!removed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: id });
}
