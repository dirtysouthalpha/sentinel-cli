// Update check: compare the running version against the latest published on npm.
// Pure semver helpers + a network check that NEVER throws (degrades to "unknown").

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a semver string into its core {major, minor, patch} components.
 * Tolerates a leading "v" and ignores any pre-release / build suffix
 * (e.g. "v1.2.3-beta.1+build" → {1,2,3}). Returns null if not parseable.
 */
export function parseSemver(v: string): Semver | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().replace(/^v/i, "");
  // Take only the core version (before any "-" prerelease or "+" build).
  const core = trimmed.split(/[-+]/)[0];
  const m = core.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/**
 * True if version `a` is strictly newer than version `b` (core x.y.z only).
 * Unparseable inputs are treated as not-newer (safe default).
 */
export function isNewer(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  if (pa.major !== pb.major) return pa.major > pb.major;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor;
  return pa.patch > pb.patch;
}

export interface UpdateCheckResult {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

export interface UpdateCheckOptions {
  /** Injected JSON fetcher (for testing). Defaults to global fetch → .json(). */
  fetchJson?: (url: string) => Promise<unknown>;
  /** Override the registry URL (defaults to the sentinel-cli npm latest dist-tag). */
  url?: string;
}

const DEFAULT_URL = "https://registry.npmjs.org/sentinel-cli/latest";

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

/**
 * Check npm for a newer published version. Never throws on network/parse
 * failure — degrades to { latest: null, updateAvailable: false }.
 */
export async function checkForUpdate(
  currentVersion: string,
  opts: UpdateCheckOptions = {}
): Promise<UpdateCheckResult> {
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const url = opts.url ?? DEFAULT_URL;
  try {
    const data = (await fetchJson(url)) as { version?: unknown } | null;
    const latest =
      data && typeof data.version === "string" ? data.version : null;
    return {
      current: currentVersion,
      latest,
      updateAvailable: latest ? isNewer(latest, currentVersion) : false,
    };
  } catch {
    return { current: currentVersion, latest: null, updateAvailable: false };
  }
}
