import fs from "fs";
import { findLogo } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** Serves data/brand-logo.* so the host can brand the dashboard without rebuilding. */
export function GET() {
  const logo = findLogo();
  if (!logo) return new Response("Not found", { status: 404 });

  let body: Buffer;
  try {
    body = fs.readFileSync(logo.file);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": logo.type,
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  };
  // An SVG opened directly is a document in our origin; never let it run script.
  if (logo.type === "image/svg+xml") {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  }
  return new Response(new Uint8Array(body), { headers });
}
