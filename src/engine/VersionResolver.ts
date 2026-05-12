/**
 * Version resolution for atlas loading.
 * Maps a replay's MC version to the best available atlas version.
 */

export interface VersionManifest {
  versions: string[];
  default: string;
}

/**
 * Parse a version string into [major, minor, patch] numbers.
 */
function parseVersion(v: string): [number, number, number] {
  const parts = v.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Resolve the best atlas version for a given MC version.
 *
 * Strategy:
 * 1. Exact match
 * 2. Closest same major.minor by absolute patch distance
 * 3. Closest same major by absolute minor distance
 * 4. Fallback to manifest default
 */
export function resolveAtlasVersion(mcVersion: string, manifest: VersionManifest): string {
  // Exact match
  if (manifest.versions.includes(mcVersion)) {
    return mcVersion;
  }

  const [major, minor, patch] = parseVersion(mcVersion);

  // Find versions with same major.minor, pick closest patch
  const sameMinor = manifest.versions.filter(v => {
    const [ma, mi] = parseVersion(v);
    return ma === major && mi === minor;
  });

  if (sameMinor.length > 0) {
    // Pick the version with the smallest absolute patch distance
    const closest = sameMinor
      .map(v => ({ v, dist: Math.abs(parseVersion(v)[2] - patch) }))
      .sort((a, b) => a.dist - b.dist);
    return closest[0].v;
  }

  // Find versions with same major, pick closest minor
  const sameMajor = manifest.versions.filter(v => {
    const [ma] = parseVersion(v);
    return ma === major;
  });

  if (sameMajor.length > 0) {
    const closest = sameMajor
      .map(v => ({ v, dist: Math.abs(parseVersion(v)[1] - minor) }))
      .sort((a, b) => a.dist - b.dist);
    return closest[0].v;
  }

  // Fallback to default
  return manifest.default;
}
