import { NextRequest, NextResponse } from "next/server";
import { updateGameName, getStoredImageUrl } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Small in-memory cache so we don't re-hit the store API for the same app
const imageCache = new Map<string, string>();

/**
 * Resolve the real (hashed) Steam header image for an app via the store API.
 * PICS gives a simplified /apps/{id}/header.jpg URL that 404s for some titles
 * (e.g. unreleased games); the store API returns the correct hashed URL.
 */
export async function GET(req: NextRequest) {
  const appId = req.nextUrl.searchParams.get("appId");
  const depotId = req.nextUrl.searchParams.get("depotId") || undefined;

  if (!appId || !/^\d+$/.test(appId)) {
    return NextResponse.json({ error: "appId required" }, { status: 400 });
  }

  if (imageCache.has(appId)) {
    return NextResponse.json({ imageUrl: imageCache.get(appId) });
  }

  try {
    const res = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`,
      { signal: AbortSignal.timeout(8000), headers: { "Accept-Language": "en" } }
    );
    if (res.ok) {
      const data = await res.json();
      const entry = data?.[appId];
      const img: string | undefined = entry?.data?.header_image || entry?.data?.capsule_image;
      if (img) {
        imageCache.set(appId, img);
        // Persist so future loads use the working URL directly. This endpoint is
        // open to every viewer, so only write when the depot is already mapped to
        // this same app; otherwise any caller could rename an arbitrary depot by
        // pairing it with an unrelated appId.
        const name: string | undefined = entry?.data?.name;
        const stored = depotId ? getStoredImageUrl("steam", depotId) : null;
        if (depotId && name && stored && stored.includes(`/apps/${appId}/`)) {
          updateGameName("steam", depotId, name, img);
        }
        return NextResponse.json({ imageUrl: img });
      }
    }
  } catch {
    /* ignore */
  }

  return NextResponse.json({ imageUrl: null });
}
