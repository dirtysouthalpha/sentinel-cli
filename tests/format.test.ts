import { describe, it, expect } from "vitest";
import {
  formatTokens,
  formatCost,
  humanizeToolCall,
  summarizeToolResult,
} from "../src/tui/format.js";

describe("formatTokens", () => {
  it("formats counts with k/M suffixes", () => {
    expect(formatTokens(840)).toBe("840");
    expect(formatTokens(12577)).toBe("12.6k");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});

describe("formatCost", () => {
  it("uses 3 dp under a dollar, 2 dp above", () => {
    expect(formatCost(0.0448)).toBe("0.045");
    expect(formatCost(1.2)).toBe("1.20");
  });
});

describe("humanizeToolCall", () => {
  it("turns raw JSON args into readable actions", () => {
    expect(humanizeToolCall("file", '{"action":"read","path":"README.md"}')).toBe("read README.md");
    expect(humanizeToolCall("bash", '{"command":"npx vitest run"}')).toBe("npx vitest run");
    expect(humanizeToolCall("search", '{"query":"stepHistory"}')).toBe('search "stepHistory"');
    expect(humanizeToolCall("web", '{"url":"https://x.com"}')).toBe("https://x.com");
  });

  it("falls back gracefully on unknown tools and bad JSON", () => {
    expect(humanizeToolCall("file", "not json")).toBe("file");
    expect(humanizeToolCall("mystery", "{}")).toBe("mystery");
  });
});

describe("summarizeToolResult", () => {
  it("reports line counts for file reads (stripping the compressor wrapper)", () => {
    expect(summarizeToolResult("file", '{"action":"read"}', true, "a\nb\nc")).toBe("3 lines");
    expect(summarizeToolResult("file", '{"action":"read"}', true, "[file output]\na\nb")).toBe("2 lines");
  });

  it("reports byte counts for writes and diff stats for edits", () => {
    expect(summarizeToolResult("file", '{"action":"write"}', true, "Written 1024 bytes to x")).toBe("1024 bytes");
    expect(summarizeToolResult("patch", "{}", true, "  ctx\n+ added line\n- removed line")).toBe("+1 −1");
  });

  it("reports match counts and bash first lines", () => {
    expect(summarizeToolResult("search", "{}", true, "hit1\nhit2\nhit3")).toBe("3 matches");
    expect(summarizeToolResult("bash", "{}", true, "PASS 21 tests\n...")).toBe("PASS 21 tests");
  });

  it("surfaces the error line when the tool failed", () => {
    expect(summarizeToolResult("file", '{"action":"read"}', false, "File not found: x")).toBe("File not found: x");
  });
});
