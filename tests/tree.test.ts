import { describe, it, expect } from "vitest";
import { buildTree, formatTree, parseGitignore, shouldIgnore } from "../src/core/tree-builder.js";

describe("parseGitignore — parse .gitignore patterns", () => {
  it("parses simple patterns", () => {
    const patterns = parseGitignore("node_modules\n*.log\n.env\n");
    expect(patterns).toContain("node_modules");
    expect(patterns).toContain("*.log");
    expect(patterns).toContain(".env");
  });
  it("ignores comments and blank lines", () => {
    expect(parseGitignore("# comment\n\n  \nsrc")).toEqual(["src"]);
  });
});

describe("shouldIgnore — glob matching", () => {
  const patterns = ["node_modules", "*.log", ".env", "dist", ".git"];
  it("matches exact dir/file names", () => {
    expect(shouldIgnore("node_modules", patterns)).toBe(true);
    expect(shouldIgnore("dist", patterns)).toBe(true);
    expect(shouldIgnore(".git", patterns)).toBe(true);
  });
  it("matches glob patterns", () => {
    expect(shouldIgnore("app.log", patterns)).toBe(true);
    expect(shouldIgnore("error.log", patterns)).toBe(true);
  });
  it("does not match non-ignored files", () => {
    expect(shouldIgnore("src", patterns)).toBe(false);
    expect(shouldIgnore("main.ts", patterns)).toBe(false);
  });
});

describe("buildTree — pure directory tree builder", () => {
  it("builds a tree from a flat list of entries", () => {
    const entries = [
      { path: "src/main.ts", isDir: false, size: 100 },
      { path: "src/utils.ts", isDir: false, size: 50 },
      { path: "README.md", isDir: false, size: 200 },
    ];
    const tree = buildTree(entries);
    expect(tree.name).toBe(".");
    expect(tree.children).toHaveLength(2); // src/ + README.md
    const src = tree.children.find((c) => c.name === "src")!;
    expect(src.children).toHaveLength(2);
    expect(src.children.find((c) => c.name === "main.ts")?.size).toBe(100);
  });
  it("filters ignored entries", () => {
    const entries = [
      { path: "src/main.ts", isDir: false, size: 10 },
      { path: "node_modules/x.js", isDir: false, size: 10 },
      { path: "app.log", isDir: false, size: 10 },
    ];
    const tree = buildTree(entries, ["node_modules", "*.log"]);
    const allPaths = JSON.stringify(tree);
    expect(allPaths).not.toContain("node_modules");
    expect(allPaths).not.toContain("app.log");
    expect(allPaths).toContain("main.ts");
  });
  it("respects a max depth", () => {
    const entries = [
      { path: "a/b/c/d/e.ts", isDir: false, size: 10 },
    ];
    const tree = buildTree(entries, [], 2);
    const allPaths = JSON.stringify(tree);
    // Depth 2 means a/b is shown but c/d/e.ts is not
    expect(allPaths).toContain('"a"');
    expect(allPaths).toContain('"b"');
    expect(allPaths).not.toContain("e.ts");
  });
  it("handles empty input", () => {
    const tree = buildTree([]);
    expect(tree.name).toBe(".");
    expect(tree.children).toEqual([]);
  });
});

describe("formatTree — render as indented text", () => {
  it("renders a tree with └── ├── connectors", () => {
    const entries = [
      { path: "src/main.ts", isDir: false, size: 100 },
      { path: "README.md", isDir: false, size: 200 },
    ];
    const out = formatTree(buildTree(entries));
    expect(out).toContain("README.md");
    expect(out).toContain("src/");
    expect(out).toContain("main.ts");
    // Has tree connectors
    expect(out).toMatch(/[└├]/);
  });
  it("includes file sizes", () => {
    const entries = [{ path: "big.ts", isDir: false, size: 2048 }];
    const out = formatTree(buildTree(entries));
    expect(out).toContain("2.0");
    expect(out).toMatch(/KB|MB|B/);
  });
});
