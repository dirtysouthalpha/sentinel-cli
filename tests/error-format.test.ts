import { describe, it, expect } from "vitest";
import { formatChatError, isAbortError } from "../src/ai/error-format.js";
import { ProviderError } from "../src/ai/errors.js";

describe("isAbortError", () => {
  it("detects AbortError by name", () => {
    const e = new Error("The operation was aborted");
    e.name = "AbortError";
    expect(isAbortError(e)).toBe(true);
  });

  it("detects abort by message", () => {
    expect(isAbortError(new Error("This operation was aborted"))).toBe(true);
  });

  it("is false for ordinary errors", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError("nope")).toBe(false);
  });
});

describe("formatChatError", () => {
  it("explains auth failures and names the env var", () => {
    const msg = formatChatError(new ProviderError("nope", 401, "anthropic"), "anthropic/claude-opus-4-8");
    expect(msg).toContain("Authentication failed for anthropic");
    expect(msg).toContain("ANTHROPIC_API_KEY");
    expect(msg).toContain("/connect");
  });

  it("explains model-not-found with the model id", () => {
    const msg = formatChatError(new ProviderError("nope", 404, "zai"), "zai/glm-4.6");
    expect(msg).toContain('"zai/glm-4.6"');
    expect(msg).toContain("/model");
  });

  it("explains rate limits and server errors", () => {
    expect(formatChatError(new ProviderError("x", 429, "zai"), "zai/glm-4.6")).toMatch(/rate limited/i);
    expect(formatChatError(new ProviderError("x", 503, "zai"), "zai/glm-4.6")).toContain("server error (HTTP 503)");
  });

  it("explains network errors, with an Ollama-specific hint", () => {
    const generic = formatChatError(new Error("fetch failed: ECONNREFUSED"), "openai/gpt-4");
    expect(generic).toMatch(/can't reach openai/i);
    const ollama = formatChatError(new Error("connect ECONNREFUSED 127.0.0.1:11434"), "ollama/llama3");
    expect(ollama).toContain("is Ollama running?");
  });

  it("passes through an unknown error message unchanged", () => {
    expect(formatChatError(new Error("something odd happened"), "zai/glm-4.6")).toBe("something odd happened");
  });
});
