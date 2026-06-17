import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createFileTool } from "../src/tools/file.js";

/**
 * B9: the `file edit` action must NOT silently replace the first of multiple
 * matches (the patch tool already enforced this; file did not). With the guard,
 * a non-unique edit is refused unless replaceAll: true. Line-range edits stay
 * unique by construction.
 */
describe("file edit uniqueness guard", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sentinel-file-"));
  });

  it("refuses when the search text appears more than once", async () => {
    const p = join(root, "a.txt");
    writeFileSync(p, "todo: fix\ntodo: fix\n");
    const file = createFileTool(root);
    const res = await file.execute({
      action: "edit",
      path: "a.txt",
      searchLines: ["todo: fix"],
      replaceText: "done: fixed",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/2 occurrences|more .* context|replaceAll/i);
    // File untouched.
    expect(readFileSync(p, "utf-8")).toBe("todo: fix\ntodo: fix\n");
  });

  it("replaces all occurrences when replaceAll: true", async () => {
    const p = join(root, "a.txt");
    writeFileSync(p, "todo: fix\ntodo: fix\n");
    const file = createFileTool(root);
    const res = await file.execute({
      action: "edit",
      path: "a.txt",
      searchLines: ["todo: fix"],
      replaceText: "done: fixed",
      replaceAll: true,
    });
    expect(res.success).toBe(true);
    expect(readFileSync(p, "utf-8")).toBe("done: fixed\ndone: fixed\n");
  });

  it("edits a unique match normally (no false refusal)", async () => {
    const p = join(root, "a.txt");
    writeFileSync(p, "alpha\nbeta\n");
    const file = createFileTool(root);
    const res = await file.execute({
      action: "edit",
      path: "a.txt",
      searchLines: ["beta"],
      replaceText: "BETA",
    });
    expect(res.success).toBe(true);
    expect(readFileSync(p, "utf-8")).toBe("alpha\nBETA\n");
  });

  it("line-range edits bypass the guard (inherently unique)", async () => {
    const p = join(root, "a.txt");
    // Same line twice — a text match would be ambiguous, but a line range is exact.
    writeFileSync(p, "dup\ndup\ndup\n");
    const file = createFileTool(root);
    const res = await file.execute({
      action: "edit",
      path: "a.txt",
      lineStart: 2,
      lineEnd: 2,
      replaceText: "unique",
    });
    expect(res.success).toBe(true);
    expect(readFileSync(p, "utf-8")).toBe("dup\nunique\ndup\n");
  });
});
