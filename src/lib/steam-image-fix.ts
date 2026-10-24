import { updateGameName } from "./queries";

// Steam answers the *unhashed* header URL that PICS hands out
// (…/store_item_assets/steam/apps/<id>/header.jpg) with HTTP 200 and a ~1.4 KB
// grey placeholder for many newer titles (e.g. Battlefield 6). The browser
// never fires onError for it, so the client-side store-API retry never runs and
// the card shows a blank tile. This checks those URLs server-side in the
// background and swaps in the real (hashed) header from the store API.

const PLACEHOLDER_MAX_BYTES = 4_000;
const BATCH = 6;

interface FixState {
  checked: Map<string, string | null>; // original URL -> replacement (null = original is fine)
  running: boolean;
}

const g = globalThis as unknown as { __lancacheSteamImageFix?: FixState };
function state(): FixState {
  if (!g.__lancacheSteamImageFix) g.__lancacheSteamImageFix = { checked: new Map(), running: false };
  return g.__lancacheSteamImageFix;
}

/** Unhashed Steam header URLs are the only ones that can be placeholders. */
export function unhashedAppId(url: string): string | null {
  const m = url.match(/^https:\/\/[a-z.]*steamstatic\.com\/(?:store_item_assets\/)?steam\/apps\/(\d+)\/header\.jpg(?:\?.*)?$/);
  return m ? m[1] : null;
}

/** Replacement URL for a known placeholder, if one has been found. */
export function knownReplacement(url: string): string | null {
  return state().checked.get(url) ?? null;
}

async function isPlaceholder(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return true;
    const len = Number(res.headers.get("content-length"));
    return Number.isFinite(len) && len > 0 && len < PLACEHOLDER_MAX_BYTES;
  } catch {
    return false; // network trouble: leave it alone, retry on a later pass
  }
}

async function storeHeader(appId: string): Promise<{ name?: string; image?: string } | null> {
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`, {
      signal: AbortSignal.timeout(8000),
      headers: { "Accept-Language": "en" },
    });
    if (!res.ok) return null;
    const entry = (await res.json())?.[appId];
    const image: string | undefined = entry?.data?.header_image;
    return image ? { name: entry?.data?.name, image } : null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget: verify up to BATCH unchecked Steam header URLs and persist a
 * working one for every depot that uses a placeholder.
 */
export async function fixSteamImages(games: { service: string; gameId: string; gameName: string; imageUrl: string }[]): Promise<void> {
  const st = state();
  if (st.running) return;

  const byUrl = new Map<string, { depots: { gameId: string; gameName: string }[]; appId: string }>();
  for (const game of games) {
    if (game.service !== "steam" || !game.imageUrl || st.checked.has(game.imageUrl)) continue;
    const appId = unhashedAppId(game.imageUrl);
    if (!appId) continue;
    const entry = byUrl.get(game.imageUrl) ?? { depots: [], appId };
    entry.depots.push({ gameId: game.gameId, gameName: game.gameName });
    byUrl.set(game.imageUrl, entry);
  }
  if (byUrl.size === 0) return;

  st.running = true;
  try {
    for (const [url, { depots, appId }] of Array.from(byUrl).slice(0, BATCH)) {
      if (!(await isPlaceholder(url))) {
        st.checked.set(url, null);
        continue;
      }
      const found = await storeHeader(appId);
      if (!found?.image || found.image === url) continue; // try again on a later pass
      st.checked.set(url, found.image);
      for (const d of depots) updateGameName("steam", d.gameId, d.gameName || found.name || "", found.image);
    }
  } finally {
    st.running = false;
  }
}
