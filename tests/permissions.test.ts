import { describe, it, expect } from "vitest";
import { PermissionEngine, categorize } from "../src/core/permissions.js";

const ROOT = process.cwd();

describe("categorize", () => {
  it("classifies tools and actions", () => {
    expect(categorize({ tool: "file", action: "read" })).toBe("read");
    expect(categorize({ tool: "file", action: "write" })).toBe("edit");
    expect(categorize({ tool: "patch" })).toBe("edit");
    expect(categorize({ tool: "search" })).toBe("read");
    expect(categorize({ tool: "bash", command: "ls" })).toBe("bash");
    expect(categorize({ tool: "git", action: "status" })).toBe("read");
    expect(categorize({ tool: "git", action: "commit" })).toBe("git");
    expect(categorize({ tool: "web" })).toBe("network");
  });
});

describe("PermissionEngine", () => {
  it("yolo allows everything", () => {
    const e = new PermissionEngine("yolo", {}, ROOT);
    expect(e.evaluate({ tool: "bash", command: "rm -rf /" }).decision).toBe("allow");
    expect(e.evaluate({ tool: "file", action: "delete", path: "x" }).decision).toBe("allow");
  });

  it("gated allows reads, asks for mutations (no config)", () => {
    const e = new PermissionEngine("gated", {}, ROOT);
    expect(e.evaluate({ tool: "file", action: "read", path: "a.ts" }).decision).toBe("allow");
    expect(e.evaluate({ tool: "file", action: "write", path: "a.ts" }).decision).toBe("ask");
    expect(e.evaluate({ tool: "bash", command: "ls" }).decision).toBe("ask");
  });

  it("auto allows in-project edits, asks for bash", () => {
    const e = new PermissionEngine("auto", {}, ROOT);
    expect(e.evaluate({ tool: "file", action: "write", path: "src/x.ts" }).decision).toBe("allow");
    expect(e.evaluate({ tool: "bash", command: "ls" }).decision).toBe("ask");
  });

  it("config rules override mode defaults", () => {
    const cfg = {
      bash: "allow" as const,
      edit: { "src/**": "allow" as const, "*": "ask" as const },
      read: "allow" as const,
    };
    const e = new PermissionEngine("gated", cfg, ROOT);
    expect(e.evaluate({ tool: "bash", command: "ls" }).decision).toBe("allow");
    expect(e.evaluate({ tool: "file", action: "write", path: "src/a.ts" }).decision).toBe("allow");
    expect(e.evaluate({ tool: "file", action: "write", path: "secrets.txt" }).decision).toBe("ask");
  });

  it("escalates allow -> ask for edits outside the project root", () => {
    const e = new PermissionEngine("auto", { edit: "allow" as const }, ROOT);
    expect(e.evaluate({ tool: "file", action: "write", path: "../outside.ts" }).decision).toBe("ask");
    expect(e.evaluate({ tool: "file", action: "write", path: "inside.ts" }).decision).toBe("allow");
  });
});
