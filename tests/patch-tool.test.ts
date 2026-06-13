import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPatchTool } from "../src/tools/patch.js";

describe("patch tool", () => {
  let dir: string;
  let tool: ReturnType<typeof createPatchTool>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sentinel-patch-"));
    tool = createPatchTool(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function seed(name: string, content: string): string {
    writeFileSync(join(dir, name), content, "utf8");
    return name;
  }

  it("applies a unique exact substring patch", async () => {
    const f = seed("a.ts", "const x = 1;\n");
    const res = await tool.execute({ path: f, oldText: "= 1", newText: "= 2" });
    expect(res.success).toBe(true);
    expect(readFileSync(join(dir, f), "utf8")).toBe("const x = 2;\n");
  });

  it("refuses multiple occurrences unless all:true", async () => {
    const f = seed("d.ts", "a;\na;\n");
    const res = await tool.execute({ path: f, oldText: "a;", newText: "b;" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/2 occurrences/i);
    // Untouched.
    expect(readFileSync(join(dir, f), "utf8")).toBe("a;\na;\n");
  });

  it("replaces all occurrences with all:true", async () => {
    const f = seed("e.ts", "a;\na;\n");
    const res = await tool.execute({ path: f, oldText: "a;", newText: "b;", all: true });
    expect(res.success).toBe(true);
    expect(readFileSync(join(dir, f), "utf8")).toBe("b;\nb;\n");
  });

  it("falls back to a whitespace-tolerant match on indentation drift", async () => {
    // File is TAB-indented; oldText uses spaces, so the exact substring is
    // genuinely absent and the whitespace-tolerant fallback must kick in.
    const f = seed("f.ts", "function g() {\n\treturn 1;\n}\n");
    const res = await tool.execute({ path: f, oldText: "    return 1;", newText: "    return 2;" });
    expect(res.success).toBe(true);
    expect(readFileSync(join(dir, f), "utf8")).toBe("function g() {\n    return 2;\n}\n");
  });

  it("blocks path traversal", async () => {
    const res = await tool.execute({ path: "../../etc/passwd", oldText: "x", newText: "y" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/traversal/i);
  });
});
