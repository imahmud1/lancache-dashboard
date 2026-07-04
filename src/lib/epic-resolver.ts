// Epic Games resolution.
//
// Epic download URLs look like /Builds/{ArtifactName}/CloudDir/... where the
// artifact name is Epic's internal app identifier. For some titles it's a
// readable name (Fortnite), for others an internal codename. There is no public
// depot->name dataset like Steam's PICS, and full resolution would require an
// authenticated Epic session (which this project deliberately avoids), so we
// take the artifact name straight from the log path and tidy it for display.

// Known Epic artifact -> display name overrides (lowercase keys).
// Intentionally empty: the artifact name in the URL is the ground truth, so we
// show it verbatim (humanized) rather than asserting a friendlier name that
// might be wrong. Add an entry only when a mapping is verified.
const EPIC_APP_NAMES: Record<string, string> = {};

function humanizeArtifact(s: string): string {
  const spaced = s
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced || s;
}

/**
 * Resolve an Epic game_id to a display name. Accepts both the current format
 * (just the artifact, e.g. "UnrealEngineLauncher") and the legacy format that
 * older parser versions stored (e.g. "Builds/UnrealEngineLauncher" or
 * "seg1/seg2"), so existing databases display correctly without a reprocess.
 */
export function resolveEpicName(gameId: string): string {
  let artifact = (gameId || "").trim();
  if (artifact.includes("/")) {
    const parts = artifact.split("/").filter(Boolean);
    const buildsIdx = parts.findIndex((p) => p.toLowerCase() === "builds");
    artifact = buildsIdx >= 0 && parts[buildsIdx + 1] ? parts[buildsIdx + 1] : parts[parts.length - 1];
  }
  return EPIC_APP_NAMES[artifact.toLowerCase()] ?? humanizeArtifact(artifact);
}
