import { describe, it, expect, vi } from "vitest";
import {
  runAutopilot,
  isComplete,
  summarizeAutopilot,
  type IterationReport,
} from "../src/core/autopilot.js";

function report(over: Partial<IterationReport> = {}): IterationReport {
  return {
    iteration: over.iteration ?? 1,
    summary: over.summary ?? "",
    checksPassed: over.checksPassed ?? false,
    productionReady: over.productionReady ?? false,
    remaining: over.remaining ?? [],
    changed: over.changed ?? true,
  };
}

describe("isComplete", () => {
  it("requires checks, gate, and no remaining work", () => {
    expect(isComplete(report({ checksPassed: true, productionReady: true, remaining: [] }))).toBe(true);
    expect(isComplete(report({ checksPassed: false, productionReady: true, remaining: [] }))).toBe(false);
    expect(isComplete(report({ checksPassed: true, productionReady: false, remaining: [] }))).toBe(false);
    expect(isComplete(report({ checksPassed: true, productionReady: true, remaining: ["x"] }))).toBe(false);
  });
});

describe("runAutopilot", () => {
  it("stops as soon as an iteration is production-ready", async () => {
    const run = vi.fn(async (i: number) =>
      report({ iteration: i, checksPassed: i >= 2, productionReady: i >= 2, remaining: [] })
    );
    const result = await runAutopilot(run, { maxIterations: 10, maxStalls: 5 });
    expect(result.status).toBe("production_ready");
    expect(result.iterations).toBe(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxStalls consecutive no-change iterations", async () => {
    const run = vi.fn(async (i: number) => report({ iteration: i, changed: false }));
    const result = await runAutopilot(run, { maxIterations: 10, maxStalls: 2 });
    expect(result.status).toBe("stalled");
    expect(result.iterations).toBe(2); // two stalls in a row
  });

  it("resets the stall counter when an iteration makes progress", async () => {
    // change, no-change, change, no-change, ... never two stalls in a row
    const run = vi.fn(async (i: number) => report({ iteration: i, changed: i % 2 === 1 }));
    const result = await runAutopilot(run, { maxIterations: 4, maxStalls: 2 });
    expect(result.status).toBe("max_iterations");
    expect(result.iterations).toBe(4);
  });

  it("honors the iteration budget", async () => {
    const run = vi.fn(async (i: number) => report({ iteration: i, changed: true }));
    const result = await runAutopilot(run, { maxIterations: 3, maxStalls: 10 });
    expect(result.status).toBe("max_iterations");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("aborts before the next iteration when isAborted() becomes true", async () => {
    let aborted = false;
    const run = vi.fn(async (i: number) => {
      if (i === 1) aborted = true; // cancel during the first iteration
      return report({ iteration: i, changed: true });
    });
    const result = await runAutopilot(run, { maxIterations: 10, maxStalls: 5 }, () => aborted);
    expect(result.status).toBe("aborted");
    expect(run).toHaveBeenCalledTimes(1); // iteration 2 never starts
  });

  it("clamps nonsensical bounds to >=1", async () => {
    const run = vi.fn(async (i: number) => report({ iteration: i, changed: false }));
    const result = await runAutopilot(run, { maxIterations: 0, maxStalls: 0 });
    expect(run).toHaveBeenCalledTimes(1); // maxIterations clamped to 1
    expect(result.status).toBe("stalled"); // maxStalls clamped to 1, iter 1 made no change
  });

  it("resumes from priorReports, continuing iteration numbering and the stall counter", async () => {
    const prior = [report({ iteration: 1, changed: false })]; // already one stall
    const run = vi.fn(async (i: number) => report({ iteration: i, changed: false }));
    const result = await runAutopilot(run, { maxIterations: 10, maxStalls: 2, priorReports: prior });
    expect(run).toHaveBeenCalledTimes(1); // one more stall → 2 in a row
    expect(result.status).toBe("stalled");
    expect(result.iterations).toBe(2);
  });

  it("preflight stops the loop early as budget_exhausted", async () => {
    let calls = 0;
    const run = vi.fn(async (i: number) => report({ iteration: i, changed: true }));
    const result = await runAutopilot(run, {
      maxIterations: 10,
      maxStalls: 5,
      preflight: () => (++calls > 2 ? "budget_exhausted" : null),
    });
    expect(result.status).toBe("budget_exhausted");
    expect(run).toHaveBeenCalledTimes(2); // ran twice, stopped before the 3rd
  });

  it("calls onIteration after each iteration (for checkpointing)", async () => {
    const lengths: number[] = [];
    const run = vi.fn(async (i: number) => report({ iteration: i, changed: true, checksPassed: i >= 2, productionReady: i >= 2 }));
    await runAutopilot(run, { maxIterations: 5, maxStalls: 5, onIteration: (r) => lengths.push(r.length) });
    expect(lengths).toEqual([1, 2]);
  });
});

describe("summarizeAutopilot", () => {
  it("describes each terminal status", () => {
    expect(summarizeAutopilot({ status: "production_ready", iterations: 3, reports: [report()] })).toContain("Production-ready");
    expect(summarizeAutopilot({ status: "stalled", iterations: 2, reports: [report({ remaining: ["wire X"] })] })).toContain("wire X");
    expect(summarizeAutopilot({ status: "aborted", iterations: 1, reports: [report()] })).toContain("Stopped by you");
    expect(summarizeAutopilot({ status: "max_iterations", iterations: 10, reports: [report()] })).toContain("budget");
  });
});
