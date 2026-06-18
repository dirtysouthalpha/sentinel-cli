import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { globProject } from "../src/core/project-files.js";

describe("globProject (@-mention autocomplete)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sentinel-glob-"));
    // A small project tree.
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "README.md"), "# x");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), "export {}");
    writeFileSync(join(root, "src", "app.ts"), "export {}");
    // Noise that must be skipped.
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "node_modules", "evil.js"), "x");
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, ".git", "config"), "x");
    // Hidden file skipped.
    writeFileSync(join(root, ".env"), "SECRET=x");
  });

  it("returns project-relative paths matching a substring query", () => {
    const out = globProject(root, "index");
    expect(out).toContain("src/index.ts");
  });

  it("empty query returns (a capped slice of) all files", () => {
    const out = globProject(root, "");
    expect(out).toContain("package.json");
    expect(out).toContain("src/app.ts");
  });

  it("skips node_modules, .git, and hidden files", () => {
    const out = globProject(root, "");
    expect(out.some((p) => p.includes("node_modules"))).toBe(false);
    expect(out.some((p) => p.includes(".git"))).toBe(false);
    expect(out).not.toContain(".env");
  });

  it("is case-insensitive", () => {
    const out = globProject(root, "README");
    expect(out).toContain("README.md");
    const out2 = globProject(root, "readme");
    expect(out2).toContain("README.md");
  });

  it("respects the max cap", () => {
    const out = globProject(root, "", 2);
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("returns [] for a missing root without throwing", () => {
    expect(globProject(join(root, "does-not-exist"), "")).toEqual([]);
  });
});
