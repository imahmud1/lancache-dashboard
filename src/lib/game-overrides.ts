import { watchedJson } from "./data-file";

// Operator-supplied names/artwork for content the dashboard can't identify on
// its own (Epic artifacts, Battle.net titles with no Steam counterpart, or a
// Steam depot with a wrong/missing mapping). Lives in data/game-overrides.json:
//
//   {
//     "blizzard:wow":       { "name": "World of Warcraft", "image": "https://..." },
//     "epicgames:Fortnite": { "image": "https://..." },
//     "steam:2807966":      { "name": "Battlefield 6" }
//   }
//
// Keys are "<service>:<gameId>" exactly as shown in Cached Games (case-insensitive).
// Either field may be omitted. Re-read automatically when the file changes.

export interface GameOverride {
  name?: string;
  image?: string;
}

const MAX_NAME_LEN = 120;

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function parseOverrides(raw: unknown): Map<string, GameOverride> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("expected an object of service:gameId -> override");
  const out = new Map<string, GameOverride>();
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.includes(":") || !val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const o: GameOverride = {};
    if (typeof v.name === "string" && v.name.trim()) o.name = v.name.trim().slice(0, MAX_NAME_LEN);
    // Only plain http(s) URLs: these are rendered as <img src> for every viewer.
    if (typeof v.image === "string" && isHttpUrl(v.image.trim())) o.image = v.image.trim();
    if (o.name || o.image) out.set(key.trim().toLowerCase(), o);
  }
  return out;
}

const overrides = watchedJson("game-overrides.json", parseOverrides, new Map<string, GameOverride>());

export function getGameOverride(service: string, gameId: string): GameOverride | null {
  return overrides().get(`${service}:${gameId}`.toLowerCase()) ?? null;
}
