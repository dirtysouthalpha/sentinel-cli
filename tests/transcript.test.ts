import { describe, it, expect } from "vitest";
import { capTranscript, TRIM_MARKER } from "../src/tui/transcript.js";

describe("capTranscript", () => {
  it("returns text unchanged when within the cap", () => {
    const t = "a\nb\nc";
    expect(capTranscript(t, 3)).toBe(t);
    expect(capTranscript(t, 10)).toBe(t);
    expect(capTranscript("", 5)).toBe("");
  });

  it("keeps only the most recent lines and prepends the marker when over the cap", () => {
    const t = "1\n2\n3\n4\n5";
    expect(capTranscript(t, 2)).toBe(`${TRIM_MARKER}\n4\n5`);
  });

  it("trims only on newline boundaries (never splits a Blessed tag)", () => {
    const t = "{red-fg}old{/}\n{red-fg}new{/}";
    const out = capTranscript(t, 1);
    expect(out).toBe(`${TRIM_MARKER}\n{red-fg}new{/}`);
    // Balanced braces preserved: equal number of "{" and "}".
    const opens = (out.match(/\{/g) || []).length;
    const closes = (out.match(/\}/g) || []).length;
    expect(opens).toBe(closes);
  });

  it("treats a non-positive cap as keeping the final line", () => {
    const t = "a\nb\nc";
    expect(capTranscript(t, 0)).toBe(`${TRIM_MARKER}\nc`);
    expect(capTranscript(t, -5)).toBe(`${TRIM_MARKER}\nc`);
  });

  it("marker itself contains no Blessed tags", () => {
    expect(TRIM_MARKER).not.toMatch(/[{}]/);
  });
});
