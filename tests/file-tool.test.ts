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
});
