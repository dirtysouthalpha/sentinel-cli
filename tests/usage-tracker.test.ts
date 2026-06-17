import { describe, it, expect } from "vitest";
import { UsageTracker, usageTracker } from "../src/core/usage-tracker.js";

describe("UsageTracker", () => {
  it("records tokens and computes snapshot math", () => {
    const t = new UsageTracker(() => 1000);
    t.recordTokens({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    t.recordTokens({ promptTokens: 200, completionTokens: 80, totalTokens: 280 });

    const snap = t.snapshot();
    expect(snap.promptTokens).toBe(300);
    expect(snap.completionTokens).toBe(130);
    expect(snap.totalTokens).toBe(430);
    expect(snap.requests).toBe(2);
    expect(snap.startedAt).toBe(1000);
  });

  it("ignores undefined token usage", () => {
    const t = new UsageTracker();
    t.recordTokens(undefined);
    expect(t.snapshot().requests).toBe(0);
  });

  it("tracks per-tool calls with ok/fail counts", () => {
    const t = new UsageTracker();
    t.recordTool("bash", true);
    t.recordTool("bash", false);
    t.recordTool("read_file", true, 12);

    const snap = t.snapshot();
    expect(snap.toolCounts.bash).toEqual({ calls: 2, ok: 1, fail: 1 });
    expect(snap.toolCounts.read_file).toEqual({ calls: 1, ok: 1, fail: 0 });
  });

  it("accumulates estimated cost", () => {
    const t = new UsageTracker();
    t.recordCostUSD(0.01);
    t.recordCostUSD(0.005);
    expect(t.snapshot().estimatedCostUSD).toBeCloseTo(0.015, 6);
  });

  it("snapshot returns copies (no external mutation)", () => {
    const t = new UsageTracker();
    t.recordTool("bash", true);
    const snap = t.snapshot();
    snap.toolCounts.bash.calls = 999;
    expect(t.snapshot().toolCounts.bash.calls).toBe(1);
  });

  it("render contains totals and a per-tool table sorted by calls", () => {
    const t = new UsageTracker();
    t.recordTokens({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    t.recordCostUSD(0.0042);
    t.recordTool("read_file", true);
    t.recordTool("bash", true);
    t.recordTool("bash", false);
    t.recordTool("bash", true);

    const out = t.render();
    expect(out).toContain("Usage:");
    expect(out).toContain("Total:");
    expect(out).toContain("$0.0042");
    expect(out).toContain("TOOL");
    expect(out).toContain("CALLS");
    expect(out).toContain("bash");
    expect(out).toContain("read_file");
    // bash (3 calls) should appear before read_file (1 call)
    expect(out.indexOf("bash")).toBeLessThan(out.indexOf("read_file"));
  });

  it("render handles no tools used", () => {
    const t = new UsageTracker();
    expect(t.render()).toContain("(none used)");
  });

  it("budget: over and under", () => {
    const t = new UsageTracker();
    t.setBudgetUSD(0.01);
    expect(t.overBudget()).toBe(false);
    t.recordCostUSD(0.005);
    expect(t.overBudget()).toBe(false);
    t.recordCostUSD(0.01);
    expect(t.overBudget()).toBe(true);
    expect(t.render()).toContain("OVER BUDGET");
  });

  it("overBudget is false when no budget set", () => {
    const t = new UsageTracker();
    t.recordCostUSD(9999);
    expect(t.overBudget()).toBe(false);
  });

  it("exports a shared singleton instance", () => {
    expect(usageTracker).toBeInstanceOf(UsageTracker);
  });
});
