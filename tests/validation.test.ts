import { describe, it, expect } from "vitest";
import { validateModelString, validateCommandName, validatePath } from "../src/utils/validation.js";

describe("validation", () => {
  it("should validate model strings", () => {
    expect(validateModelString("anthropic/claude-sonnet")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet",
    });
    expect(validateModelString("gpt-4o")).toEqual({
      provider: "anthropic",
      model: "gpt-4o",
    });
    expect(validateModelString("a/b/c")).toBeNull();
  });

  it("should validate command names", () => {
    expect(validateCommandName("test")).toBe(true);
    expect(validateCommandName("my-command")).toBe(true);
    expect(validateCommandName("123")).toBe(false);
    expect(validateCommandName("")).toBe(false);
  });

  it("should validate paths", () => {
    expect(validatePath("src/index.ts")).toBe(true);
    expect(validatePath("../etc/passwd")).toBe(false);
    expect(validatePath("/etc/passwd")).toBe(false);
  });
});
