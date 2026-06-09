import { describe, it, expect } from "vitest";
import { applyRouterConfig, DEFAULT_ROUTER_URL, DEFAULT_CLAUDE_MODEL } from "../src/core/router-connect.js";

describe("applyRouterConfig", () => {
  it("points anthropic at the router (keyless) and sets the model", () => {
    const out = applyRouterConfig({});
    const provider = (out.provider as any).anthropic;
    expect(provider.options.baseURL).toBe(DEFAULT_ROUTER_URL);
    expect(provider.options.apiKey).toBeUndefined(); // keyless — proxy injects auth
    expect(out.model).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("preserves other providers and is non-mutating", () => {
    const input = { provider: { zai: { options: { apiKey: "k" } } }, model: "zai/glm-4.6" };
    const out = applyRouterConfig(input, "http://localhost:9000/v1/anthropic", "anthropic/claude-opus-4-8");
    expect((out.provider as any).zai.options.apiKey).toBe("k"); // untouched
    expect((out.provider as any).anthropic.options.baseURL).toBe("http://localhost:9000/v1/anthropic");
    expect(out.model).toBe("anthropic/claude-opus-4-8");
    // original not mutated
    expect((input.provider as any).anthropic).toBeUndefined();
    expect(input.model).toBe("zai/glm-4.6");
  });
});
