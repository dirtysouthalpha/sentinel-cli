/**
 * Model pricing registry + cost estimation (V17 groundwork). Replaces the
 * hardcoded $3/$15-per-Mtok assumption in the TUI with a per-model table so cost
 * tracking is accurate across providers. Pure + dependency-free.
 *
 * Prices are USD per 1M tokens. Matched by longest key that is a substring of the
 * model id (so "anthropic/claude-opus-4-8" matches "claude-opus"). Unknown models
 * fall back to DEFAULT_PRICING.
 */

export interface ModelPrice {
  inputPerMtok: number;
  outputPerMtok: number;
}

export const DEFAULT_PRICING: ModelPrice = { inputPerMtok: 3, outputPerMtok: 15 };

// Keyed by a distinctive model-id substring. Order doesn't matter; longest match wins.
export const PRICING: Record<string, ModelPrice> = {
  "claude-opus": { inputPerMtok: 15, outputPerMtok: 75 },
  "claude-sonnet": { inputPerMtok: 3, outputPerMtok: 15 },
  "claude-haiku": { inputPerMtok: 1, outputPerMtok: 5 },
  "gpt-4o-mini": { inputPerMtok: 0.15, outputPerMtok: 0.6 },
  "gpt-4o": { inputPerMtok: 2.5, outputPerMtok: 10 },
  "gpt-4.1": { inputPerMtok: 2, outputPerMtok: 8 },
  "o1": { inputPerMtok: 15, outputPerMtok: 60 },
  "gemini-1.5-pro": { inputPerMtok: 1.25, outputPerMtok: 5 },
  "gemini-1.5-flash": { inputPerMtok: 0.075, outputPerMtok: 0.3 },
  "gemini-2": { inputPerMtok: 0.1, outputPerMtok: 0.4 },
  "glm-4": { inputPerMtok: 0.6, outputPerMtok: 2.2 },
  "glm-5": { inputPerMtok: 0.6, outputPerMtok: 2.2 },
  // Local runtimes are free.
  "ollama": { inputPerMtok: 0, outputPerMtok: 0 },
  "local": { inputPerMtok: 0, outputPerMtok: 0 },
  "hermes-agent": { inputPerMtok: 0, outputPerMtok: 0 },
};

/** Resolve pricing for a model id by longest substring key match. */
export function getPricing(model: string): ModelPrice {
  if (!model) return DEFAULT_PRICING;
  const id = model.toLowerCase();
  let best: { key: string; price: ModelPrice } | null = null;
  for (const [key, price] of Object.entries(PRICING)) {
    if (id.includes(key) && (!best || key.length > best.key.length)) {
      best = { key, price };
    }
  }
  return best ? best.price : DEFAULT_PRICING;
}

/** Estimate USD cost for a single model call. */
export function estimateCostUSD(model: string, promptTokens: number, completionTokens: number): number {
  const p = getPricing(model);
  const cost = (promptTokens / 1_000_000) * p.inputPerMtok + (completionTokens / 1_000_000) * p.outputPerMtok;
  // round to 6 decimals to avoid float noise in displays
  return Math.round(cost * 1e6) / 1e6;
}
