import { describe, it, expect } from "vitest";
import { resolveSelection, mergeModels } from "../src/tui/switcher.js";

describe("resolveSelection", () => {
  const list = ["zai/glm-4.6", "anthropic/claude-sonnet", "openai/gpt-4o"];

  it("selects by 1-based index", () => {
    expect(resolveSelection(list, "1")).toBe("zai/glm-4.6");
    expect(resolveSelection(list, "3")).toBe("openai/gpt-4o");
  });

  it("returns null for an out-of-range or zero index", () => {
    expect(resolveSelection(list, "0")).toBeNull();
    expect(resolveSelection(list, "9")).toBeNull();
  });

  it("matches an exact id", () => {
    expect(resolveSelection(list, "anthropic/claude-sonnet")).toBe("anthropic/claude-sonnet");
  });

  it("matches a unique trailing segment, case-insensitively", () => {
    expect(resolveSelection(list, "glm-4.6")).toBe("zai/glm-4.6");
    expect(resolveSelection(list, "GPT-4O")).toBe("openai/gpt-4o");
  });

  it("returns null for an unknown or empty arg", () => {
    expect(resolveSelection(list, "nope")).toBeNull();
    expect(resolveSelection(list, "  ")).toBeNull();
  });
});

describe("mergeModels", () => {
  const curated = ["zai/glm-4.6", "anthropic/claude-sonnet", "openai/gpt-4o", "ollama/llama3"];

  it("puts the current model first and only includes available-provider curated models", () => {
    const out = mergeModels(curated, [], ["zai", "ollama"], "zai/glm-4.6");
    expect(out[0]).toBe("zai/glm-4.6");
    expect(out).toContain("ollama/llama3");
    expect(out).not.toContain("anthropic/claude-sonnet"); // provider not available
    expect(out).not.toContain("openai/gpt-4o");
  });

  it("includes config-declared models even if not curated, and de-dupes", () => {
    const out = mergeModels(curated, ["custom/my-model", "zai/glm-4.6"], ["zai"], "zai/glm-4.6");
    expect(out).toContain("custom/my-model");
    expect(out.filter((m) => m === "zai/glm-4.6")).toHaveLength(1);
  });

  it("keeps the current model first even when its provider is unavailable", () => {
    const out = mergeModels(curated, [], ["openai"], "zai/glm-4.6");
    expect(out[0]).toBe("zai/glm-4.6");
    expect(out).toContain("openai/gpt-4o");
  });
});
