import { describe, it, expect } from "vitest";
import { parseMarkdownBlocks } from "../src/core/markdown.js";

describe("shared markdown parser — new block kinds", () => {
  it("classifies an ATX heading", () => {
    const blocks = parseMarkdownBlocks("# Title");
    expect(blocks.length).toBe(1);
    expect(blocks[0].kind).toBe("heading");
    expect((blocks[0] as { level: number }).level).toBe(1);
  });

  it("heading level tracks the # count (1-6)", () => {
    expect((parseMarkdownBlocks("### Sub")[0] as { level: number }).level).toBe(3);
    expect((parseMarkdownBlocks("###### Deepest")[0] as { level: number }).level).toBe(6);
  });

  it("classifies a thematic break (--- after a blank line) as hr", () => {
    const blocks = parseMarkdownBlocks("intro\n\n---\n\nafter");
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain("hr");
  });

  it("classifies a GFM table (header + separator + row) as a table block", () => {
    const blocks = parseMarkdownBlocks("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(blocks.length).toBe(1);
    expect(blocks[0].kind).toBe("table");
  });

  it("does not treat a lone prose line as a table (needs the separator row)", () => {
    const blocks = parseMarkdownBlocks("| a | b |\n| 1 | 2 |");
    // No --- separator -> stays prose.
    expect(blocks[0].kind).toBe("prose");
  });

  it("classifies a GFM task list as tasklist (and plain bullets stay prose-ish)", () => {
    const blocks = parseMarkdownBlocks("- [ ] todo\n- [x] done");
    expect(blocks[0].kind).toBe("tasklist");
  });

  it("preserves existing code-block classification", () => {
    const blocks = parseMarkdownBlocks("```ts\nconst x = 1;\n```");
    expect(blocks[0].kind).toBe("code");
  });

  it("preserves existing diff classification", () => {
    const blocks = parseMarkdownBlocks("@@\n+add\n-del\n");
    expect(blocks[0].kind).toBe("diff");
  });
});
