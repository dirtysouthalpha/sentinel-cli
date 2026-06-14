import { describe, it, expect } from "vitest";
import { providerEnvVar } from "../src/ai/provider.js";

describe("providerEnvVar", () => {
  it("maps known providers to their API-key env var", () => {
    expect(providerEnvVar("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(providerEnvVar("openai")).toBe("OPENAI_API_KEY");
    expect(providerEnvVar("zai")).toBe("ZAI_API_KEY");
    expect(providerEnvVar("zhipu")).toBe("ZAI_API_KEY");
    expect(providerEnvVar("gemini")).toBe("GEMINI_API_KEY");
    expect(providerEnvVar("google")).toBe("GEMINI_API_KEY");
  });

  it("returns undefined for providers without a known key var", () => {
    expect(providerEnvVar("ollama")).toBeUndefined();
    expect(providerEnvVar("some-custom-endpoint")).toBeUndefined();
  });
});
