import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/tui/render-markdown.js";

const colors: Record<string, string> = {
  cyan: "cyan",
  lime: "green",
  amber: "yellow",
  error: "red",
  textPrimary: "white",
  textSecondary: "gray",
  textTertiary: "dim",
  border: "blue",
  bgSecondary: "black",
};

describe("renderMarkdown", () => {
  it("frames a fenced block with a language header and escaped code content", () => {
    const out = renderMarkdown("```ts\nconst x = 1;\n```", colors);
    // Header shows the language in the dim/tertiary color.
    expect(out).toContain(`{${colors.textTertiary}-fg}`);
    expect(out).toContain("ts");
    // Code body is rendered in the secondary color, content preserved.
    expect(out).toContain(`{${colors.textSecondary}-fg}const x = 1;{/}`);
  });

  it("escapes Blessed braces inside code to {open}/{close}", () => {
    const out = renderMarkdown("```js\nfn() {}\n```", colors);
    expect(out).toContain("fn() {open}{close}");
    expect(out).not.toContain("fn() {}");
  });

  it("colors unified-diff lines inside a code block", () => {
    const src = "```diff\n+added line\n-removed line\n@@ -1,2 +1,2 @@\n```";
    const out = renderMarkdown(src, colors);
    expect(out).toContain(`{${colors.lime}-fg}+added line{/}`);
    expect(out).toContain(`{${colors.error}-fg}-removed line{/}`);
    expect(out).toContain(`{${colors.cyan}-fg}@@ -1,2 +1,2 @@{/}`);
  });

  it("colors standalone diff runs (no fence) that look like a real diff", () => {
    const src = "@@ -1 +1 @@\n-old\n+new";
    const out = renderMarkdown(src, colors);
    expect(out).toContain(`{${colors.cyan}-fg}@@ -1 +1 @@{/}`);
    expect(out).toContain(`{${colors.error}-fg}-old{/}`);
    expect(out).toContain(`{${colors.lime}-fg}+new{/}`);
  });

  it("leaves plain markdown bullet lists as prose (no false diff coloring)", () => {
    const src = "- first item\n- second item";
    const out = renderMarkdown(src, colors);
    expect(out).not.toContain(`{${colors.error}-fg}`);
    expect(out).toContain("- first item");
    expect(out).toContain("- second item");
  });

  it("styles inline code spans in an accent color", () => {
    const out = renderMarkdown("run `npm run build` to compile", colors);
    expect(out).toContain(`{${colors.cyan}-fg}npm run build{/}`);
    expect(out).toContain("run ");
    expect(out).toContain(" to compile");
  });

  it("passes plain prose through unchanged (only escaped)", () => {
    const out = renderMarkdown("just some normal prose here", colors);
    expect(out).toBe("just some normal prose here");
  });

  it("escapes braces in prose to {open}/{close}", () => {
    const out = renderMarkdown("text with {braces} here", colors);
    expect(out).toContain("text with {open}braces{close} here");
  });

  it("returns empty string for empty input", () => {
    expect(renderMarkdown("", colors)).toBe("");
  });

  it("does not throw on an unterminated fence and still renders code", () => {
    let out = "";
    expect(() => {
      out = renderMarkdown("```js\ncode without a closing fence", colors);
    }).not.toThrow();
    expect(out).toContain(`{${colors.textSecondary}-fg}code without a closing fence{/}`);
  });

  it("never emits stray unescaped braces from content", () => {
    const out = renderMarkdown("```\na = {b: `c`}\n```", colors);
    // No raw { that is not part of an emitted tag like {color-fg} or {/} or {open}/{close}.
    const stripped = out.replace(/\{[^}]*-fg\}|\{\/\}|\{open\}|\{close\}/g, "");
    expect(stripped).not.toContain("{");
    expect(stripped).not.toContain("}");
  });
});
