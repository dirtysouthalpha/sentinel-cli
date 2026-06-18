import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  STEPS,
  getProvider,
  detectNeeds,
  nextStep,
  buildResult,
} from "../src/core/onboarding.js";

describe("onboarding catalog", () => {
  it("offers providers recommended-first with Z.ai at the top", () => {
    expect(PROVIDERS[0].id).toBe("zai");
    expect(PROVIDERS.some((p) => p.id === "ollama")).toBe(true);
    expect(PROVIDERS.some((p) => p.id === "claude-router")).toBe(true);
  });

  it("every provider has at least one starter model", () => {
    for (const p of PROVIDERS) expect(p.models.length).toBeGreaterThanOrEqual(1);
  });

  it("STEPS walks provider -> key -> model -> done", () => {
    expect(STEPS).toEqual(["provider", "key", "model", "done"]);
  });
});

describe("getProvider", () => {
  it("finds a provider by id", () => {
    expect(getProvider("zai")?.label).toMatch(/Z\.ai/);
    expect(getProvider("ollama")?.noKey).toBe(true);
  });
  it("returns undefined for an unknown id", () => {
    expect(getProvider("nope")).toBeUndefined();
  });
});

describe("detectNeeds (first-run intercept)", () => {
  const emptyEnv = {} as NodeJS.ProcessEnv;

  it("needs onboarding when nothing is configured", () => {
    expect(detectNeeds(emptyEnv, [])).toBe(true);
  });

  it("does NOT intercept when an env var is set (env-first)", () => {
    expect(detectNeeds({ ZAI_API_KEY: "sk-x" }, [])).toBe(false);
    expect(detectNeeds({ ANTHROPIC_API_KEY: "sk-ant-x" }, [])).toBe(false);
    expect(detectNeeds({ ZHIPU_API_KEY: "x" }, [])).toBe(false);
  });

  it("does NOT intercept when a provider already resolves to a key", () => {
    expect(detectNeeds(emptyEnv, ["zai"])).toBe(false);
  });

  it("ZHIPU alias satisfies zai", () => {
    expect(detectNeeds({ ZHIPU_API_KEY: "x" }, [])).toBe(false);
  });
});

describe("nextStep (step machine)", () => {
  it("keyed provider: provider -> key -> model -> done", () => {
    expect(nextStep("provider", "zai")).toBe("key");
    expect(nextStep("key", "zai")).toBe("model");
    expect(nextStep("model", "zai")).toBe("done");
  });

  it("keyless provider with one model: provider -> done (skips key + model)", () => {
    expect(nextStep("provider", "ollama")).toBe("done"); // ollama has 1 model
  });

  it("keyless provider with multiple models: provider -> model -> done", () => {
    expect(nextStep("provider", "claude-router")).toBe("model");
    expect(nextStep("model", "claude-router")).toBe("done");
  });

  it("done stays done", () => {
    expect(nextStep("done")).toBe("done");
  });
});

describe("buildResult", () => {
  it("keyed provider carries the api key", () => {
    const r = buildResult({ providerId: "zai", model: "zai/glm-4.6", apiKey: "sk-real" });
    expect(r.apiKey).toBe("sk-real");
    expect(r.model).toBe("zai/glm-4.6");
    expect(r.baseURL).toBeUndefined();
  });

  it("keyless provider omits the api key", () => {
    const r = buildResult({ providerId: "ollama", model: "ollama/llama3" });
    expect(r.apiKey).toBeUndefined();
  });

  it("claude-router sets the OAuth router baseURL", () => {
    const r = buildResult({ providerId: "claude-router", model: "anthropic/claude-sonnet" });
    expect(r.apiKey).toBeUndefined();
    expect(r.baseURL).toMatch(/127\.0\.0\.1/);
  });

  it("trims whitespace from the key", () => {
    const r = buildResult({ providerId: "anthropic", model: "anthropic/claude-sonnet", apiKey: "  sk-x  " });
    expect(r.apiKey).toBe("sk-x");
  });
});
