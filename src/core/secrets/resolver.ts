import { getSecretStore } from "./store.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger({ prefix: "secrets" });

/**
 * Map each provider to the env var that historically held its key, so the
 * env-first resolution path honors the existing ANTHROPIC_API_KEY / ZAI_API_KEY
 * / OPENAI_API_KEY / GEMINI_API_KEY fallbacks (and Ollama needs no key).
 */
export const PROVIDER_ENV: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  zai: ["ZAI_API_KEY", "ZHIPU_API_KEY"],
  zhipu: ["ZHIPU_API_KEY", "ZAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

/** The logical secret name under which a provider key is stored. */
export function providerKeyName(provider: string): string {
  return `${provider}.apiKey`;
}

/**
 * Resolve a provider's API key, env-first:
 *
 *   1. process.env (<PROVIDER>_API_KEY) — safest default for fleet/cron/CI.
 *   2. The platform secret store (keyring / DPAPI / encrypted file).
 *   3. Legacy plaintext from config.json (read-only; present only until the
 *      one-time migration scrubs it).
 *
 * Returns the key string, or "" when none is configured. Never throws.
 */
export async function resolveProviderApiKey(
  provider: string,
  legacyPlaintext?: string
): Promise<string> {
  // 1. Env.
  const envVars = PROVIDER_ENV[provider];
  if (envVars) {
    for (const v of envVars) {
      const val = process.env[v];
      if (val && val.trim()) {
        log.debug(`resolved ${provider} key from env ${v}`);
        return val.trim();
      }
    }
  }

  // 2. Secret store.
  try {
    const store = await getSecretStore();
    const fromStore = await store.get(providerKeyName(provider));
    if (fromStore) {
      log.debug(`resolved ${provider} key from ${store.kind}`);
      return fromStore;
    }
  } catch (err) {
    log.warn(`secret store unavailable for ${provider}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Legacy plaintext fallback.
  if (legacyPlaintext && legacyPlaintext.trim()) {
    log.debug(`resolved ${provider} key from legacy plaintext config`);
    return legacyPlaintext.trim();
  }

  return "";
}

/**
 * One-time migration: if a provider's key exists only in legacy plaintext,
 * move it into the secret store and return the names that were migrated (so the
 * caller can scrub them from config.json).
 *
 * Env-var keys are NOT migrated (the env owns those). Keys already in the store
 * are left alone. Returns the list of provider names whose plaintext should now
 * be scrubbed.
 */
export async function migrateProviderKeysToStore(
  providers: Record<string, unknown>
): Promise<string[]> {
  const migrated: string[] = [];
  const store = await getSecretStore();

  for (const [name, raw] of Object.entries(providers || {})) {
    const envVars = PROVIDER_ENV[name];
    const inEnv = envVars?.some((v) => process.env[v]?.trim()) ?? false;
    if (inEnv) continue; // env owns it

    // Extract the plaintext key from the nested {options:{apiKey}} or flat shape.
    const cfg = raw as { options?: { apiKey?: string }; apiKey?: string };
    const plaintext = cfg?.options?.apiKey ?? cfg?.apiKey;
    if (!plaintext || !plaintext.trim()) continue;

    const alreadyInStore = await store.get(providerKeyName(name));
    if (alreadyInStore) {
      migrated.push(name); // store wins; scrub the redundant plaintext too
      continue;
    }

    const ok = await store.set(providerKeyName(name), plaintext.trim());
    if (ok) {
      migrated.push(name);
      log.info(`migrated ${name} key to ${store.kind}`);
    } else {
      log.warn(`could not migrate ${name} key to store; leaving plaintext in place`);
    }
  }

  return migrated;
}
