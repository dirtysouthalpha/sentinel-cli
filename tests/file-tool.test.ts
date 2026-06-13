import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileTool } from "../src/tools/file.js";

describe("file tool — edit robustness", () => {
  let dir: string;
  let tool: ReturnType<typeof createFileTool>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sentinel-file-"));
    tool = createFileTool(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function seed(name: string, content: string): string {
    const p = join(dir, name);
    writeFileSync(p, content, "utf8");
    return name;
  }

  it("edits a unique exact match", async () => {
    const f = seed("a.ts", "const x = 1;\nconst y = 2;\n");
    const res = await tool.execute({
      action: "edit",
      path: f,
      searchLines: ["const y = 2;"],
      replaceText: "const y = 3;",
    });
    expect(res.success).toBe(true);
    expect(readFileSync(join(dir, f), "utf8")).toBe("const x = 1;\nconst y = 3;\n");
  });

  it("refuses an ambiguous exact match instead of editing the wrong copy", async () => {
    const f = seed("dup.ts", "foo();\nbar();\nfoo();\n");
    const res = await tool.execute({
      action: "edit",
      path: f,
      searchLines: ["foo();"],
      replaceText: "baz();",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/appears 2 times/i);
    // File is untouched.
    expect(readFileSync(join(dir, f), "utf8")).toBe("foo();\nbar();\nfoo();\n");
  });

  it("applies a whitespace-tolerant match when indentation drifts", async () => {
    const f = seed("indent.ts", "function f() {\n    return 42;\n}\n");
    // Model supplies the line without the exact 4-space indent.
    const res = await tool.execute({
      action: "edit",
      path: f,
      searchLines: ["return 42;"],
      replaceText: "    return 43;",
    });
    expect(res.success).toBe(true);
    expect(readFileSync(join(dir, f), "utf8")).toBe("function f() {\n    return 43;\n}\n");
    // The model is told it was a fuzzy match so it can double-check.
    expect(res.output).toMatch(/whitespace-tolerant match/i);
    expect((res.data as { matchType: string }).matchType).toBe("tolerant");
  });

  it("labels an exact match as exact", async () => {
    const f = seed("exact.ts", "const y = 2;\n");
    const res = await tool.execute({ action: "edit", path: f, searchLines: ["const y = 2;"], replaceText: "const y = 3;" });
    expect(res.success).toBe(true);
    expect(res.output).not.toMatch(/whitespace-tolerant/i);
    expect((res.data as { matchType: string }).matchType).toBe("exact");
  });

  it("honors strictWhitespace by refusing a non-exact match", async () => {
    const f = seed("strict.ts", "function f() {\n    return 42;\n}\n");
    const res = await tool.execute({
      action: "edit",
      path: f,
      searchLines: ["return 42;"],
      replaceText: "return 43;",
      strictWhitespace: true,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/strictWhitespace/i);
  });

  it("refuses an ambiguous whitespace-insensitive match", async () => {
    const f = seed("dup2.ts", "  a();\n  a();\n");
    const res = await tool.execute({
      action: "edit",
      path: f,
      searchLines: ["a();"],
      replaceText: "b();",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/ambiguous/i);
  });

  it("edits an exact line range even when identical text exists elsewhere", async () => {
    const f = seed("range.ts", "dup\nkeep\ndup\n");
    // Target line 3 specifically; a content search for "dup" would be ambiguous.
    const res = await tool.execute({
      action: "edit",
      path: f,
      lineStart: 3,
      lineEnd: 3,
      replaceText: "changed",
    });
    expect(res.success).toBe(true);
    expect(readFileSync(join(dir, f), "utf8")).toBe("dup\nkeep\nchanged\n");
  });

  it("reports when text is not found", async () => {
    const f = seed("nf.ts", "hello\n");
    const res = await tool.execute({
      action: "edit",
      path: f,
      searchLines: ["nonexistent"],
      replaceText: "x",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it("preview does not modify the file", async () => {
    const original = "const x = 1;\n";
    const f = seed("prev.ts", original);
    const res = await tool.execute({
      action: "preview",
      path: f,
      searchLines: ["const x = 1;"],
      replaceText: "const x = 2;",
    });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/Preview/);
    expect(readFileSync(join(dir, f), "utf8")).toBe(original);
  });

  it("blocks path traversal outside the project root", async () => {
    const res = await tool.execute({ action: "read", path: "../../etc/passwd" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/traversal/i);
  });

  describe("read windowing", () => {
    it("returns a small file whole, with no truncation note", async () => {
      const f = seed("small.ts", "a\nb\nc\n");
      const res = await tool.execute({ action: "read", path: f });
      expect(res.success).toBe(true);
      expect(res.output).toBe("a\nb\nc\n");
      expect(res.output).not.toMatch(/showing lines/);
    });

    it("windows by offset/limit", async () => {
      const f = seed("win.ts", Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join("\n"));
      const res = await tool.execute({ action: "read", path: f, offset: 10, limit: 3 });
      expect(res.success).toBe(true);
      expect(res.output).toContain("line10\nline11\nline12");
      expect(res.output).toMatch(/showing lines 10-12 of 100/);
    });

    it("refuses to dump a binary file as text", async () => {
      const f = seed("bin.dat", "abc");
      // Overwrite with bytes containing NUL.
      writeFileSync(join(dir, f), Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47, 0x0a]));
      const res = await tool.execute({ action: "read", path: f });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/binary file/i);
    });

    it("char-caps a minified single-line file that line-windowing can't bound", async () => {
      const f = seed("min.js", "x".repeat(250_000)); // one logical line
      const res = await tool.execute({ action: "read", path: f });
      expect(res.success).toBe(true);
      expect(res.output.length).toBeLessThan(250_000);
      expect(res.output).toMatch(/minified|truncated to 100000 chars/i);
    });

    it("caps an oversized file read and says so", async () => {
      const big = Array.from({ length: 2500 }, (_, i) => `L${i + 1}`).join("\n");
      const f = seed("big.ts", big);
      const res = await tool.execute({ action: "read", path: f });
      expect(res.success).toBe(true);
      expect(res.output).toMatch(/showing lines 1-2000 of 2500/);
      expect(res.output).not.toContain("L2001");
      expect((res.data as { totalLines: number }).totalLines).toBe(2500);
    });
  });
});
