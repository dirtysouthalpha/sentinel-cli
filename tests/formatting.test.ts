import { describe, it, expect } from "vitest";
import { truncate, wordWrap, formatBytes, formatDuration, table, stripAnsi } from "../src/utils/formatting.js";

describe("formatting", () => {
  it("should truncate long text", () => {
    expect(truncate("hello world", 5)).toBe("he...");
    expect(truncate("hi", 5)).toBe("hi");
  });

  it("should wrap text", () => {
    const result = wordWrap("a b c d e f g h i j", 10);
    const lines = result.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it("should format bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
  });

  it("should format duration", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(90000)).toBe("1.5m");
  });

  it("should format tables", () => {
    const result = table(
      [["a", "bb"], ["ccc", "d"]],
      ["Col1", "Col2"]
    );
    expect(result).toContain("Col1");
    expect(result).toContain("─");
  });

  it("should strip ANSI codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });
});
