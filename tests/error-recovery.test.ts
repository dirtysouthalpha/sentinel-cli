import { describe, it, expect } from "vitest";
import { wrapToolError } from "../src/core/error-recovery.js";

describe("wrapToolError (recovery nudge)", () => {
  it("passes a successful result through unchanged", () => {
    expect(wrapToolError("all good", true)).toBe("all good");
  });

  it("appends the research-and-retry nudge to a failed result", () => {
    const out = wrapToolError("ERROR: command not found", false);
    expect(out).toContain("command not found");
    expect(out).toMatch(/web.*search|look up/i);
    expect(out).toMatch(/retry|fix/i);
    expect(out).toMatch(/create_skill/);
  });

  it("truncates a huge error before the nudge so it stays readable", () => {
    const huge = "ERROR: " + "x".repeat(10000);
    const out = wrapToolError(huge, false, 100);
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toContain("[truncated]");
    expect(out).toMatch(/create_skill/); // nudge still present after truncation
  });

  it("the nudge tells the model not to stop unless research fails", () => {
    expect(wrapToolError("ERROR: x", false)).toMatch(/don't stop|only report failure/i);
  });
});
