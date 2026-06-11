// Battle.net product codes → game names + Steam appIds (for cover art).
// Source: https://github.com/tpill90/battlenet-lancache-prefill/blob/master/BattleNetPrefill/TactProduct.cs
// Steam appIds mapped where the same game exists on Steam (for header images).

interface BNetGame {
  name: string;
  steamAppId?: number; // for cover art via Steam CDN
}

const PRODUCTS: Record<string, BNetGame> = {
  // Blizzard
  rtro: { name: "Blizzard Arcade Collection" },
  anbs: { name: "Diablo: Immortal" },
  osi: { name: "Diablo 2: Resurrected", steamAppId: 2536520 },
  d3: { name: "Diablo 3" },
  fenris: { name: "Diablo 4", steamAppId: 2344520 },
  hsb: { name: "Hearthstone" },
  hero: { name: "Heroes of the Storm" },
  s1: { name: "Starcraft Remastered" },
  s2: { name: "Starcraft 2" },
  pro: { name: "Overwatch", steamAppId: 2357570 },
  w1r: { name: "Warcraft 1: Remastered" },
  w2r: { name: "Warcraft 2: Remastered" },
  w3: { name: "Warcraft 3: Reforged" },
  wow: { name: "World of Warcraft" },
  wow_classic: { name: "WoW Cataclysm Classic" },
  wow_classic_era: { name: "WoW Classic" },

  // Activision
  viper: { name: "Call of Duty: Black Ops 4" },
  zeus: { name: "Call of Duty: Black Ops Cold War", steamAppId: 1985810 },
  odin: { name: "Call of Duty: Modern Warfare 2019", steamAppId: 2000950 },
  auks: { name: "Call of Duty", steamAppId: 1938090 },
  lazr: { name: "Call of Duty: MW2 Remastered" },
  fore: { name: "Call of Duty: Vanguard", steamAppId: 1985820 },
  wlby: { name: "Crash Bandicoot 4", steamAppId: 1378990 },
  cod: { name: "Call of Duty", steamAppId: 1938090 },

  // Microsoft
  aqua: { name: "Avowed", steamAppId: 2457220 },
  scor: { name: "Sea of Thieves", steamAppId: 1172620 },

  // CDN hostname variants (different from TACT codes but map to same games)
  ovw: { name: "Overwatch", steamAppId: 2357570 },
  war3: { name: "Warcraft 3: Reforged" },
  sc2: { name: "Starcraft 2" },
  hs: { name: "Hearthstone" },

  // Launcher / infrastructure (not games, but named so they don't show as "Unknown")
  catalogs: { name: "Battle.net Launcher" },
  kr: { name: "Battle.net (Korea)" },
};

/**
 * Extract a Battle.net product identifier from log data.
 */
export function extractBattleNetProduct(requestPath: string, upstreamHost: string): string | null {
  const hostMatch = upstreamHost.match(/^([a-z0-9_]+?)(?:-assets)?\.cdn\.blizzard\.com$/i);
  if (hostMatch) return hostMatch[1].toLowerCase();

  const pathMatch = requestPath.match(/^\/tpr\/([a-z0-9_]+)\//i);
  if (pathMatch) return pathMatch[1].toLowerCase();

  return null;
}

/**
 * Resolve a Battle.net product code to a game name.
 */
export function resolveBattleNetGame(productCode: string): string | null {
  return PRODUCTS[productCode.toLowerCase()]?.name || null;
}

/**
 * Get the Steam header image URL for a Battle.net game (if a Steam version exists).
 */
export function getBattleNetImageUrl(productCode: string): string | null {
  const appId = PRODUCTS[productCode.toLowerCase()]?.steamAppId;
  if (!appId) return null;
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
}
