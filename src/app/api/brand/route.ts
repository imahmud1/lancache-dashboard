import { NextResponse } from "next/server";
import { getBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** Public: name, tagline, accent and logo URL for the dashboard and /display. */
export function GET() {
  return NextResponse.json(getBrand());
}
