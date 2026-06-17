import { describe, it, expect } from "vitest";
import { visibleLength, wrapTagged, renderCard } from "../src/tui/cards.js";

describe("visibleLength", () => {
  it("ignores control tags but counts literal-brace escapes", () => {
    expect(visibleLength("abc")).toBe(3);
    expect(visibleLength("{cyan-fg}abc{/}")).toBe(3);
    expect(visibleLength("{open}x{close}")).toBe(3); // { x }  -> 3 visible cols
    expect(visibleLength("")).toBe(0);
  });
});

describe("wrapTagged", () => {
  it("wraps plain prose on word boundaries", () => {
    expect(wrapTagged("the quick brown fox", 9)).toEqual(["the quick", "brown fox"]);
  });

  it("keeps every wrapped line within the width", () => {
    const lines = wrapTagged("alpha beta gamma delta epsilon", 11);
    for (const ln of lines) expect(visibleLength(ln)).toBeLessThanOrEqual(11);
  });

  it("preserves hard newlines and blank lines", () => {
    expect(wrapTagged("a\n\nb", 10)).toEqual(["a", "", "b"]);
  });

  it("hard-breaks a word longer than the width", () => {
    const lines = wrapTagged("abcdefgh", 3);
    expect(lines).toEqual(["abc", "def", "gh"]);
  });

  it("keeps each wrapped line tag-balanced when a span crosses the boundary", () => {
    // One colored span spanning the wrap point must close on line 1 and reopen on line 2.
    const lines = wrapTagged("{cyan-fg}one two three{/}", 7);
    for (const ln of lines) {
      const opens = (ln.match(/\{cyan-fg\}/g) || []).length;
      const closes = (ln.match(/\{\/\}/g) || []).length;
      expect(opens).toBe(closes);
      expect(opens).toBeGreaterThan(0); // styling carried onto every line
    }
  });
});

describe("renderCard", () => {
  const opts = { width: 24, labelColor: "lime", borderColor: "lime", indent: "" };

  it("draws a rounded border with the label in the header", () => {
    const card = renderCard({ ...opts, label: "you", body: "hi" });
    const lines = card.split("\n");
    expect(lines[0]).toContain("╭─ ");
    expect(lines[0]).toContain("you");
    expect(lines[0]).toContain("╮");
    expect(lines[lines.length - 1]).toContain("╰");
    expect(lines[lines.length - 1]).toContain("╯");
  });

  it("pads every body line so the right border aligns in one column", () => {
    const card = renderCard({ ...opts, label: "sentinel", body: "short\nmuch longer line here" });
    const bodyLines = card.split("\n").filter((l) => l.includes("│"));
    const widths = bodyLines.map((l) => visibleLength(l));
    expect(new Set(widths).size).toBe(1); // all body lines identical visible width
  });
});
