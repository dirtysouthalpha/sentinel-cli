import { describe, it, expect } from "vitest";
import { getContextWindow, compactionBudget, DEFAULT_CONTEXT_WINDOW } from "../src/core/context-window.js";
import { ContextManager } from "../src/ai/context.js";

describe("context-window", () => {
  it("matches known models by substring (longest wins)", () => {
    expect(getContextWindow("anthropic/claude-opus-4-8")).toBe(200_000);
    expect(getContextWindow("zai/glm-4.6")).toBe(128_000);
    expect(getContextWindow("openai/gpt-4.1")).toBe(1_000_000);
  });

  it("falls back to the default for unknown models", () => {
    expect(getContextWindow("some/unknown-model")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(getContextWindow("")).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("compactionBudget reserves headroom below the full window", () => {
    expect(compactionBudget("anthropic/claude-opus-4-8")).toBe(150_000); // 200k * 0.75
    expect(compactionBudget("zai/glm-4.6")).toBeLessThan(getContextWindow("zai/glm-4.6"));
  });

  it("ContextManager.setMaxTokens changes the compaction budget", () => {
    const cm = new ContextManager("cw");
    cm.setMaxTokens(compactionBudget("anthropic/claude-opus-4-8"));
    expect(cm.getMaxTokens()).toBe(150_000);
    // Ignores non-positive values.
    cm.setMaxTokens(0);
    expect(cm.getMaxTokens()).toBe(150_000);
  });
});
