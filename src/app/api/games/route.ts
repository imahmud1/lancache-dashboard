import { NextResponse } from "next/server";
import { getCachedGames, updateGameName } from "@/lib/queries";
import { resolveDepotBatch, getResolvedDepots } from "@/lib/steam-resolver";
import { resolveBattleNetGame, getBattleNetImageUrl } from "@/lib/battlenet-resolver";

export const dynamic = "force-dynamic";

let bgResolving = false;

/**
 * Resolve unresolved depots in the background without blocking the response.
 * Persists resolved names/images to the DB so subsequent requests have them.
 */
async function backgroundResolve(steamDepots: string[]) {
  if (bgResolving) return;
  bgResolving = true;
  try {
    await resolveDepotBatch(steamDepots, 15);
    const resolved = getResolvedDepots();
    for (const depotId of steamDepots) {
      const info = resolved[depotId];
      if (info && info.appName && !info.appName.startsWith("Depot ")) {
        updateGameName("steam", depotId, info.appName, info.headerImage || "");
      }
    }
  } catch (err) {
    console.error("[games] background resolve error:", err);
  } finally {
    bgResolving = false;
  }
}

export async function GET() {
  try {
    const games = getCachedGames(undefined, 500);

    // Find steam depots still needing resolution
    const steamDepots = games
      .filter((g) => g.service === "steam" && (!g.gameName || g.gameName.startsWith("Depot ")))
      .map((g) => g.gameId);

    // Apply any already-cached resolutions instantly (no network)
    const resolved = getResolvedDepots();
    for (const game of games) {
      if (game.service === "steam" && resolved[game.gameId]) {
        const info = resolved[game.gameId];
        if (info.appName && !info.appName.startsWith("Depot ")) {
          game.gameName = info.appName;
          game.imageUrl = info.headerImage || "";
        }
      }
    }

    // Kick off background resolution for the rest (fire-and-forget)
    if (steamDepots.length > 0) {
      void backgroundResolve(steamDepots);
    }

    // Resolve Battle.net product codes to game names + images (instant, local lookup)
    for (const game of games) {
      if (game.service === "blizzard" && !game.gameName) {
        const name = resolveBattleNetGame(game.gameId);
        if (name) {
          game.gameName = name;
          game.imageUrl = getBattleNetImageUrl(game.gameId) || "";
          updateGameName("blizzard", game.gameId, name, game.imageUrl || undefined);
        }
      }
    }

    // Deduplicate: multiple depots for the same game should be merged
    const merged = mergeByApp(games);

    const totalCachedBytes = merged.reduce((sum, g) => sum + g.totalBytes, 0);
    const totalGames = merged.length;
    const gamesInCache = merged.filter((g) => g.likelyCached).length;

    return NextResponse.json({
      games: merged,
      summary: { totalGames, gamesInCache, totalCachedBytes },
      resolving: steamDepots.length > 0,
    });
  } catch (error) {
    console.error("Error fetching cached games:", error);
    return NextResponse.json({ error: "Failed to fetch games" }, { status: 500 });
  }
}

/**
 * Merge multiple depots that belong to the same app into one entry.
 * e.g., depot 1938091, 1938092, 1938093 all belong to Call of Duty (app 1938090)
 */
function mergeByApp(games: ReturnType<typeof getCachedGames>) {
  const byKey = new Map<string, (typeof games)[0]>();

  for (const game of games) {
    // Use resolved app name + service as key, or fallback to gameId
    const key = game.gameName && !game.gameName.startsWith("Depot ")
      ? `${game.service}:${game.gameName}`
      : `${game.service}:${game.gameId}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.totalBytes += game.totalBytes;
      existing.hitCount += game.hitCount;
      existing.missCount += game.missCount;
      if (game.lastSeen > existing.lastSeen) existing.lastSeen = game.lastSeen;
      if (game.firstSeen < existing.firstSeen) existing.firstSeen = game.firstSeen;
      existing.servedFromCache = existing.servedFromCache || game.servedFromCache;
      existing.likelyCached = existing.likelyCached || game.likelyCached;
      if (!existing.imageUrl && game.imageUrl) existing.imageUrl = game.imageUrl;
    } else {
      byKey.set(key, { ...game });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.totalBytes - a.totalBytes);
}
