import { getSecretStore } from "./store.js";
import { providerKeyName, PROVIDER_ENV } from "./resolver.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger({ prefix: "secrets:bootstrap" });

/**
 * Populate process.env with provider keys resolved from the platform secret
 * store, so the existing synchronous provider constructors (which already read
 * process.env) pick them up with no provider-layer changes.
 *
 * Env vars already set in the real environment are never overwritten — env wins
 * (the documented resolution order). This is the bridge between the async
 * keyring and the sync provider init: resolve once at startup, set env, then
 * the sync path works as before.
 */
export async function primeEnvFromKeyring(
  providers: Record<string, unknown>
): Promise<void> {
  let store;
  try {
    store = await getSecretStore();
  } catch (err) {
    log.warn(`secret store unavailable, using env/plaintext only: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  for (const name of Object.keys(providers || {})) {
    const envVars = PROVIDER_ENV[name];
    if (!envVars) continue; // custom/unknown provider — no canonical env var
    // Skip if the env already holds a key for this provider.
    if (envVars.some((v) => process.env[v]?.trim())) continue;

    try {
      const value = await store.get(providerKeyName(name));
      if (value && value.trim()) {
        // Set the first canonical env var so the constructor fallback finds it.
        process.env[envVars[0]] = value.trim();
        log.debug(`primed ${envVars[0]} from ${store.kind}`);
      }
    } catch {
      // best-effort; a single provider failure must not block the others
    }
  }
}

/**
 * One-time migration of legacy plaintext keys into the secret store.
 *
 * Returns the list of provider names whose plaintext should now be scrubbed
 * (replaced with the sentinel marker `keyring://<name>` in config.json). The
 * caller owns the write so it goes through the normal (atomic) config-save path.
 *
 * Idempotent: running it again is a no-op once keys are in the store and the
 * config marker is in place.
 */
export async function migrateLegacyKeys(
  providers: Record<string, unknown>
): Promise<string[]> {
  let store;
  try {
    store = await getSecretStore();
  } catch {
    return []; // can't migrate without a store; leave plaintext untouched
  }

  const scrub: string[] = [];
  for (const [name, raw] of Object.entries(providers || {})) {
    const envVars = PROVIDER_ENV[name];
    if (envVars?.some((v) => process.env[v]?.trim())) continue; // env owns it

    const cfg = raw as { options?: { apiKey?: string }; apiKey?: string };
    const plaintext = cfg?.options?.apiKey ?? cfg?.apiKey;
    // Skip already-migrated entries (the marker) and empty values.
    if (!plaintext || !plaintext.trim() || plaintext.startsWith("keyring://")) continue;

    const already = await store.get(providerKeyName(name));
    if (!already) {
      const ok = await store.set(providerKeyName(name), plaintext.trim());
      if (!ok) {
        log.warn(`could not migrate ${name} key to ${store.kind}; leaving plaintext`);
        continue;
      }
      log.info(`migrated ${name} key to ${store.kind}`);
    }
    scrub.push(name);
  }
  return scrub;
}

/** Replace the plaintext apiKey in a provider block with the migration marker. */
export function applyScrubMarker(
  providers: Record<string, unknown>,
  names: string[]
): void {
  for (const name of names) {
    const raw = providers[name] as { options?: { apiKey?: string }; apiKey?: string } | undefined;
    if (!raw) continue;
    if (raw.options && typeof raw.options === "object") {
      raw.options.apiKey = `keyring://${name}`;
    } else {
      raw.apiKey = `keyring://${name}`;
    }
  }
}
