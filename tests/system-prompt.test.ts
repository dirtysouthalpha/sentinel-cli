import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.js";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt("code", "/tmp/project");

  it("identifies the assistant and project", () => {
    expect(prompt).toContain("Sentinel CLI");
    expect(prompt).toContain("/tmp/project");
  });

  it("advertises the lsp tool", () => {
    expect(prompt).toMatch(/\blsp\b/);
  });

  it("encodes the editing-discipline guidance that the tools actually enforce", () => {
    // Read-before-edit + large-file windowing.
    expect(prompt).toMatch(/read.*offset\/limit/i);
    // The uniqueness contract that file/patch enforce.
    expect(prompt).toMatch(/unique/i);
    expect(prompt).toMatch(/ambiguous/i);
    // The auto-verify / self-correction loop.
    expect(prompt).toMatch(/type-check runs automatically/i);
  });

  it("explains plan mode", () => {
    expect(prompt).toMatch(/plan mode/i);
  });
});
