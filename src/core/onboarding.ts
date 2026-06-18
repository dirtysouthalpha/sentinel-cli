/**
 * Shared first-run onboarding (pure, no UI). Drives BOTH the TUI modal flow and
 * the GUI wizard from one definition, so the two surfaces can't drift.
 *
 * Design:
 *   - detectNeeds(): true when there's no usable provider yet (no env key, no
 *     keyring/config key, no plaintext). That's the "intercept first run" signal.
 *   - PROVIDERS: the catalog the wizard offers, with recommended starter models,
 *     the env-var each reads, a free (local) option, and a keyless (OAuth
 *     router) option. Ordered recommended-first.
 *   - OnboardingStep: the minimal 3-step flow (provider → key → model). The
 *     surfaces render these; this module owns the decisions and the result.
 *
 * No TTY/DOM dependency → unit-tested directly.
 */

/** A selectable provider in the onboarding wizard. */
export interface OnboardingProvider {
  /** Config provider key (matches providerManager + PROVIDER_ENV). */
  id: "zai" | "anthropic" | "openai" | "ollama" | "claude-router";
  /** Human label for the picker. */
  label: string;
  /** One-line pitch. */
  blurb: string;
  /** Recommended starter "provider/model" id(s); the first is the default pick. */
  models: string[];
  /** Env var(s) that already satisfy this provider (no key entry needed). */
  envVars: string[];
  /** True when no API key is required (local, or keyless OAuth router). */
  noKey?: boolean;
  /** Where to obtain a key, shown in the wizard. */
  keyUrl?: string;
}

/** The ordered providers the wizard offers, recommended-first. */
export const PROVIDERS: OnboardingProvider[] = [
  {
    id: "zai",
    label: "Z.ai / Zhipu GLM",
    blurb: "Best value for coding. Recommended default.",
    models: ["zai/glm-4.6", "zai/glm-4.5-air"],
    envVars: ["ZAI_API_KEY", "ZHIPU_API_KEY"],
    keyUrl: "https://open.bigmodel.cn",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    blurb: "Strongest coding models (paid).",
    models: ["anthropic/claude-sonnet", "anthropic/claude-haiku"],
    envVars: ["ANTHROPIC_API_KEY"],
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    blurb: "GPT-4o family (paid).",
    models: ["openai/gpt-4o", "openai/gpt-4o-mini"],
    envVars: ["OPENAI_API_KEY"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "ollama",
    label: "Ollama (local, free)",
    blurb: "Run models locally — no key, no cost.",
    models: ["ollama/llama3"],
    envVars: [],
    noKey: true,
  },
  {
    id: "claude-router",
    label: "Claude via OAuth router (keyless)",
    blurb: "Ride a Claude Max subscription — no API key.",
    models: ["anthropic/claude-sonnet", "anthropic/claude-haiku"],
    envVars: [],
    noKey: true,
  },
];

/** The wizard's ordered steps. */
export type OnboardingStep = "provider" | "key" | "model" | "done";

/** The ordered step list a surface walks. */
export const STEPS: OnboardingStep[] = ["provider", "key", "model", "done"];

/**
 * The result of finishing onboarding — a provider config patch + the chosen
 * default model. The caller (CLI/GUI) owns persisting it (via the existing
 * config-store + keyring paths). If `apiKey` is set, the caller stores it in the
 * secret store and writes `keyring://<id>` into config.
 */
export interface OnboardingResult {
  providerId: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

/** Find a provider definition by id. */
export function getProvider(id: string): OnboardingProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * Decide whether onboarding is needed. True when no provider has a usable key:
 *   - no env var set for any known provider, AND
 *   - no provider configured with a real/plaintext key (the caller passes the
 *     set of provider ids that already resolve to a key).
 *
 * A user who pre-configured via ZAI_API_KEY env (common for fleet/cron) is NOT
 * intercepted — env-first resolution means they're already ready.
 */
export function detectNeeds(env: NodeJS.ProcessEnv, providersWithKey: string[]): boolean {
  // Any env key present for any provider → already ready.
  for (const p of PROVIDERS) {
    for (const v of p.envVars) {
      if (env[v]?.trim()) return false;
    }
  }
  // Any provider already resolves to a key (keyring/plaintext) → ready.
  if (providersWithKey.length > 0) return false;
  return true;
}

/**
 * Advance from the current step given a partial selection. The key step is
 * skipped for keyless providers (ollama, claude-router). Pure; surfaces call this
 * to know what to render next.
 *
 * @param current the step just completed
 * @param providerId the provider chosen (needed after the provider step)
 */
export function nextStep(
  current: OnboardingStep,
  providerId?: string
): OnboardingStep {
  if (current === "provider") {
    const p = providerId ? getProvider(providerId) : undefined;
    // Keyless providers skip straight to model (or done if only one model).
    if (p?.noKey) {
      return (p.models.length <= 1 ? "done" : "model");
    }
    return "key";
  }
  if (current === "key") return "model";
  if (current === "model") return "done";
  return "done";
}

/**
 * Build the final result from the wizard's selections. For keyless providers,
 * `apiKey` is omitted. For the Claude OAuth router, sets the router baseURL the
 * existing `connect` path uses.
 */
export function buildResult(opts: {
  providerId: string;
  model: string;
  apiKey?: string;
}): OnboardingResult {
  const p = getProvider(opts.providerId);
  const base: OnboardingResult = {
    providerId: opts.providerId,
    model: opts.model,
  };
  if (p?.noKey) {
    if (opts.providerId === "claude-router") {
      // The existing OAuth router default (router-connect.ts DEFAULT_ROUTER_URL).
      base.baseURL = "http://127.0.0.1:8080/v1/anthropic";
    }
    return base;
  }
  if (opts.apiKey?.trim()) base.apiKey = opts.apiKey.trim();
  return base;
}
