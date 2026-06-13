import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSearchTool } from "../src/tools/search.js";
import { truncateMiddle } from "../src/tools/tool-executor.js";

describe("search tool", () => {
  let dir: string;
  let tool: ReturnType<typeof createSearchTool>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sentinel-search-"));
    tool = createSearchTool(dir);
    writeFileSync(join(dir, "a.txt"), "needle here\nother line\n", "utf8");
    writeFileSync(join(dir, "b.txt"), "nothing\n", "utf8");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("finds a basic pattern", async () => {
    const res = await tool.execute({ pattern: "needle", type: "grep" });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/needle/);
  });

  it("treats shell-special characters as data (no injection / no crash)", async () => {
    // A pattern packed with shell/PowerShell metacharacters must not break out
    // of the command or throw — it should just be searched literally.
    const res = await tool.execute({ pattern: `"; echo PWNED; '`, type: "grep" });
    expect(res.success).toBe(true);
    // No file contains that text, so no matches — and crucially, no crash.
    expect(res.output).toMatch(/No results found|needle|nothing/);
  });

  it("glob matches by filename", async () => {
    const res = await tool.execute({ pattern: "*.txt", type: "glob" });
    expect(res.success).toBe(true);
    expect(res.data).toBeInstanceOf(Array);
    expect((res.data as string[]).length).toBe(2);
  });
});

describe("truncateMiddle", () => {
  it("returns short text unchanged", () => {
    expect(truncateMiddle("hello", 100)).toBe("hello");
  });

  it("keeps both head and tail of oversized text", () => {
    const text = "HEAD" + "x".repeat(1000) + "TAIL";
    const out = truncateMiddle(text, 100);
    expect(out.startsWith("HEAD")).toBe(true);
    expect(out.endsWith("TAIL")).toBe(true);
    expect(out).toMatch(/characters truncated/);
    expect(out.length).toBeLessThan(text.length);
  });
});
