import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectContext } from "../src/core/project-context.js";

describe("loadProjectContext", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sentinel-projctx-"));
    await writeFile(
      join(dir, "CLAUDE.md"),
      "# Project Guide\nLine 2\nLine 3",
      "utf8"
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "demo-pkg",
        version: "1.2.3",
        scripts: { build: "tsup", test: "vitest" },
        dependencies: { commander: "^12.0.0" },
      }),
      "utf8"
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("summarizes CLAUDE.md and package.json fields", () => {
    const ctx = loadProjectContext(dir);
    expect(ctx).toContain("CLAUDE.md (excerpt)");
    expect(ctx).toContain("# Project Guide");
    expect(ctx).toContain("name: demo-pkg");
    expect(ctx).toContain("version: 1.2.3");
    expect(ctx).toContain("scripts: build, test");
    expect(ctx).toContain("dependencies: commander");
  });

  it("stays under the ~1.5KB cap", () => {
    const ctx = loadProjectContext(dir);
    expect(ctx.length).toBeLessThanOrEqual(1500 + 20);
  });

  it("returns empty string for a directory with nothing of note", async () => {
    const empty = await mkdtemp(join(tmpdir(), "sentinel-empty-"));
    try {
      expect(loadProjectContext(empty)).toBe("");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("tolerates malformed package.json without throwing", async () => {
    const bad = await mkdtemp(join(tmpdir(), "sentinel-badpkg-"));
    try {
      await writeFile(join(bad, "package.json"), "{ not valid json", "utf8");
      expect(() => loadProjectContext(bad)).not.toThrow();
      expect(loadProjectContext(bad)).toBe("");
    } finally {
      await rm(bad, { recursive: true, force: true });
    }
  });
});
