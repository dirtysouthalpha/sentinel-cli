/**
 * Cross-platform secret storage abstraction.
 *
 * The goal: never store API keys in plaintext in config.json. Resolution order
 * for a given logical key name (e.g. "zai.apiKey"):
 *
 *   1. process.env (env-first — the safest default for fleet/cron/CI; honors
 *      the existing ANTHROPIC_API_KEY / ZAI_API_KEY / etc. fallbacks).
 *   2. The platform OS keyring (Linux Secret Service / macOS Keychain /
 *      Windows DPAPI), accessed via CLIs — no native node deps (avoids the
 *      build-dependency attack surface that bit Cline in Feb 2026).
 *   3. An encrypted-at-rest file fallback when no OS keyring is present.
 *   4. Legacy plaintext in config.json (read-only, used only so existing
 *      installs keep working until migration runs).
 *
 * Concrete providers are in the *-backend.ts files; this file picks one.
 */

export interface SecretStore {
  /** Human-readable name of the backing mechanism, for diagnostics. */
  readonly kind: string;
  /** Store a secret. Returns true on success. */
  set(name: string, value: string): Promise<boolean>;
  /** Retrieve a secret, or null if absent. Never throws on "not found". */
  get(name: string): Promise<string | null>;
  /** Remove a secret. Returns true if something was deleted. */
  delete(name: string): Promise<boolean>;
}

let cached: SecretStore | null = null;

/**
 * Resolve the platform-appropriate store. Picks lazily and caches, so callers
 * can call freely. Falls back to the encrypted file backend when no OS keyring
 * CLI is reachable (probed once, on first use).
 */
export async function getSecretStore(): Promise<SecretStore> {
  if (cached) return cached;
  const { pickBackend } = await import("./backend-picker.js");
  cached = await pickBackend();
  return cached;
}

/** Test hook: reset the cached store (so tests can swap backends). */
export function _resetSecretStoreForTests(): void {
  cached = null;
}
