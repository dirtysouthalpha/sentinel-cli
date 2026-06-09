import { describe, it, expect } from "vitest";
import { getPricing, estimateCostUSD, DEFAULT_PRICING } from "../src/core/pricing.js";

describe("pricing", () => {
  it("matches by longest substring key", () => {
    expect(getPricing("anthropic/claude-opus-4-8")).toEqual({ inputPerMtok: 15, outputPerMtok: 75 });
    expect(getPricing("anthropic/claude-sonnet-4-6")).toEqual({ inputPerMtok: 3, outputPerMtok: 15 });
    // gpt-4o-mini must win over gpt-4o (longer key)
    expect(getPricing("openai/gpt-4o-mini")).toEqual({ inputPerMtok: 0.15, outputPerMtok: 0.6 });
    expect(getPricing("openai/gpt-4o")).toEqual({ inputPerMtok: 2.5, outputPerMtok: 10 });
  });

  it("treats local/ollama/hermes as free", () => {
    expect(getPricing("ollama/llama3")).toEqual({ inputPerMtok: 0, outputPerMtok: 0 });
    expect(getPricing("sentinel-prime/hermes-agent")).toEqual({ inputPerMtok: 0, outputPerMtok: 0 });
  });

  it("falls back to default for unknown models", () => {
    expect(getPricing("some/unknown-model")).toEqual(DEFAULT_PRICING);
    expect(getPricing("")).toEqual(DEFAULT_PRICING);
  });

  it("estimates cost from token counts", () => {
    // claude-opus: 1M in @ $15 + 1M out @ $75 = $90
    expect(estimateCostUSD("claude-opus", 1_000_000, 1_000_000)).toBe(90);
    // free model
    expect(estimateCostUSD("ollama/x", 1_000_000, 1_000_000)).toBe(0);
    // partial
    expect(estimateCostUSD("claude-sonnet", 500_000, 100_000)).toBeCloseTo(0.5 * 3 + 0.1 * 15, 6);
  });
});
