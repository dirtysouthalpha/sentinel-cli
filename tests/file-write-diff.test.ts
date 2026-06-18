import { describe, it, expect } from "vitest";
import { renderWriteDiff } from "../src/tools/file.js";

describe("renderWriteDiff (file:write result diff)", () => {
  it("emits +/- only for changed lines, skipping context", () => {
    const prior = "alpha\nbeta\ngamma";
    const next = "alpha\nBETA\ngamma";
    expect(renderWriteDiff(prior, next)).toBe("- beta\n+ BETA");
  });

  it("reports a pure addition as + lines", () => {
    expect(renderWriteDiff("a\nb", "a\nb\nc")).toBe("+ c");
  });

  it("reports a pure deletion as - lines", () => {
    expect(renderWriteDiff("a\nb\nc", "a\nc")).toBe("- b");
  });

  it("reports '(no line changes)' when content is identical", () => {
    expect(renderWriteDiff("same\nhere", "same\nhere")).toBe("(no line changes)");
  });

  it("caps output at maxLines with a '… N more' trailer", () => {
    const prior = Array.from({ length: 100 }, (_, i) => `old${i}`).join("\n");
    const next = Array.from({ length: 100 }, (_, i) => `new${i}`).join("\n");
    const out = renderWriteDiff(prior, next, 5);
    const lines = out.split("\n");
    expect(lines.length).toBe(6); // 5 diffs + the trailer
    expect(lines[lines.length - 1]).toMatch(/… \(\d+ more lines?\)/);
  });
});
