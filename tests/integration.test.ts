/**
 * Integration tests — exercise REAL modules end-to-end (no provider mocks for
 * the pure layers). These catch wiring bugs that unit tests miss (like the mcp
 * duplicate-name crash).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContextManager } from "../src/ai/context.js";
import { refineGoal } from "../src/core/refine-goal.js";
import { buildTree, formatTree } from "../src/core/tree-builder.js";
import { parseTestRunnerOutput } from "../src/core/test-runner-parse.js";
import { forkMessages } from "../src/core/session-fork.js";
import { budgetThresholds } from "../src/core/budget-gate.js";
import { MemoryStore, fileBackend } from "../src/core/memory-store.js";
import { ToolResultCache, shouldCache } from "../src/core/tool-cache.js";
import { validatePluginEntry } from "../src/core/plugin-types.js";

describe("integration: refineGoal produces structured goals", () => {
  it("fix intent gets a done-condition", () => {
    const r = refineGoal("fix the bug in the parser");
    expect(r.intent).toBe("fix");
    expect(r.refined).toContain("Done when");
    expect(r.refined).toContain("parser");
  });
  it("unknown intent still produces usable output", () => {
    const r = refineGoal("login form validation");
    expect(r.refined.length).toBeGreaterThan(10);
    expect(r.refined).toContain("Done when");
  });
});

describe("integration: buildTree + formatTree on a real temp dir", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sentinel-int-"));
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "main.ts"), "console.log('hi')");
    writeFileSync(join(tmpDir, "README.md"), "# test");
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("builds a tree and formats it with connectors", () => {
    const entries = [
      { path: "src/main.ts", isDir: false, size: 19 },
      { path: "README.md", isDir: false, size: 6 },
    ];
    const tree = buildTree(entries);
    const out = formatTree(tree);
    expect(out).toContain("README.md");
    expect(out).toContain("src/");
    expect(out).toContain("main.ts");
    expect(out).toMatch(/[└├]/); // tree connectors present
  });
});

describe("integration: parseTestRunnerOutput on real vitest output", () => {
  it("parses vitest failure output correctly", () => {
    const output = "FAIL tests/foo.test.ts\n  ● foo > bar\n\n  Expected: 5\n  Received: 3\n\nTests  1 failed | 4 passed";
    const result = parseTestRunnerOutput(output, 1);
    expect(result.passed).toBe(false);
    expect(result.failCount).toBe(1);
    expect(result.passCount).toBe(4);
    expect(result.failures[0]).toContain("foo > bar");
  });
});

describe("integration: forkMessages preserves the original", () => {
  it("forking doesn't mutate the source", () => {
    const msgs = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi" },
      { role: "user" as const, content: "do thing" },
    ];
    const forked = forkMessages(msgs, 1);
    expect(forked).toHaveLength(2);
    expect(msgs).toHaveLength(3); // original untouched
    forked.push({ role: "user", content: "diverged" });
    expect(msgs).toHaveLength(3); // still untouched
  });
});

describe("integration: budgetThresholds at real thresholds", () => {
  it("returns critical at 80%", () => {
    expect(budgetThresholds(8, 10)).toBe("critical");
  });
  it("returns exceeded at 100%", () => {
    expect(budgetThresholds(10, 10)).toBe("exceeded");
  });
  it("returns ok when no budget (unlimited)", () => {
    expect(budgetThresholds(9999, 0)).toBe("ok");
  });
});

describe("integration: memory store+recall round-trip via file backend", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "sentinel-mem-")); });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("stores and recalls a memory across instances (persistence)", () => {
    const store1 = new MemoryStore(fileBackend(tmpDir), { source: "test" });
    store1.add("decision", "use OAuth not API keys", "decision");

    // Fresh instance — simulates a new session.
    const store2 = new MemoryStore(fileBackend(tmpDir), { source: "test" });
    const results = store2.query("OAuth");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("use OAuth not API keys");
    expect(results[0].region).toBe("decision");
  });
});

describe("integration: tool cache memoizes file reads", () => {
  it("returns cached result on second read with same mtime", () => {
    const cache = new ToolResultCache();
    const key = { tool: "file", args: '{"action":"read","path":"x.ts"}' };
    cache.set(key, "file contents", 1000);
    expect(cache.get(key, 1000)).toBe("file contents"); // cache hit
  });
  it("invalidates when mtime changes", () => {
    const cache = new ToolResultCache();
    const key = { tool: "file", args: '{"action":"read","path":"x.ts"}' };
    cache.set(key, "old", 1000);
    expect(cache.get(key, 2000)).toBeNull(); // mtime advanced → stale
  });
  it("shouldCache rejects mutations", () => {
    expect(shouldCache("bash", { command: "ls" })).toBe(false);
    expect(shouldCache("file", { action: "write", path: "x" })).toBe(false);
    expect(shouldCache("file", { action: "read", path: "x" })).toBe(true);
  });
});

describe("integration: validatePluginEntry security", () => {
  it("rejects path traversal in id", () => {
    const r = validatePluginEntry({ id: "../escape", type: "skill", name: "X", content: "y" });
    expect(r.ok).toBe(false);
  });
  it("accepts a valid skill", () => {
    const r = validatePluginEntry({ id: "my-skill", type: "skill", name: "My Skill", content: "# hi" });
    expect(r.ok).toBe(true);
  });
});

describe("integration: context manager handles a full conversation", () => {
  it("stores messages and produces AI-shaped output", () => {
    const cm = new ContextManager({ maxMessages: 100, maxTokens: 100000 });
    cm.setSystemPrompt("You are helpful.");
    cm.addMessage("user", "what is 2+2");
    cm.addMessage("assistant", "4");
    cm.addMessage("user", "thanks");

    const msgs = cm.toAIMessages();
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are helpful.");
    expect(msgs).toHaveLength(4); // system + 3 messages
    expect(cm.getMessageCount()).toBe(3); // excluding system
  });
});
