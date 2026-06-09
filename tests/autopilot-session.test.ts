import { describe, it, expect } from "vitest";
import { runAutopilotSession, type RunSubagentFn } from "../src/core/autopilot-session.js";

/**
 * Drives the FULL autonomous orchestration end-to-end with fakes — GSD cycle,
 * deterministic gate, model gate, remaining-feedback, stall detection — without
 * any network or subprocess. This is the mechanical "shake out" of /autopilot.
 */

/** A fake subagent: returns canned phase text, and a scripted gate verdict the
 *  Nth time the production gate is asked. */
function makeSubagent(gateVerdicts: object[]): { run: RunSubagentFn; gateCalls: number; phaseCalls: number } {
  const state = { gateCalls: 0, phaseCalls: 0 };
  const run: RunSubagentFn = async (args) => {
    if (args.outputSchema) {
      const verdict = gateVerdicts[Math.min(state.gateCalls, gateVerdicts.length - 1)];
      state.gateCalls++;
      return JSON.stringify(verdict);
    }
    state.phaseCalls++;
    return `did work for: ${args.task.split("\n")[0].slice(0, 40)}`;
  };
  return { run, get gateCalls() { return state.gateCalls; }, get phaseCalls() { return state.phaseCalls; } } as never;
}

describe("runAutopilotSession", () => {
  it("reaches production-ready when checks pass and the gate is satisfied", async () => {
    const agent = makeSubagent([
      { productionReady: false, remaining: ["wire the thing"], summary: "iter1" },
      { productionReady: true, remaining: [], summary: "done" },
    ]);
    const logs: string[] = [];
    const result = await runAutopilotSession({
      goal: "make it production-ready",
      projectRoot: "/tmp/x",
      maxIterations: 5,
      maxStalls: 3,
      runSubagent: agent.run,
      log: (m) => logs.push(m),
      verify: async () => ({ passed: true, summary: "all green" }),
      treeHash: (() => {
        let n = 0;
        return async () => `hash-${n++}`; // changes every call → never stalls
      })(),
    });
    expect(result.status).toBe("production_ready");
    expect(result.iterations).toBe(2);
    // Each iteration runs the GSD phases (≥4) plus a gate call.
    expect(agent.phaseCalls).toBeGreaterThanOrEqual(8);
  });

  it("keeps the gate honest: a 'ready' verdict is rejected when checks fail", async () => {
    const agent = makeSubagent([{ productionReady: true, remaining: [], summary: "claims done" }]);
    const result = await runAutopilotSession({
      goal: "g",
      projectRoot: "/tmp/x",
      maxIterations: 2,
      maxStalls: 5,
      runSubagent: agent.run,
      log: () => {},
      verify: async () => ({ passed: false, summary: "tests FAIL" }), // model says ready, checks disagree
      treeHash: (() => { let n = 0; return async () => `h-${n++}`; })(),
    });
    // Never production-ready because the deterministic gate never passes.
    expect(result.status).toBe("max_iterations");
    expect(result.reports.every((r) => r.productionReady === false)).toBe(true);
  });

  it("stalls when nothing changes across iterations", async () => {
    const agent = makeSubagent([{ productionReady: false, remaining: ["x"], summary: "s" }]);
    const result = await runAutopilotSession({
      goal: "g",
      projectRoot: "/tmp/x",
      maxIterations: 10,
      maxStalls: 2,
      runSubagent: agent.run,
      log: () => {},
      verify: async () => ({ passed: false, summary: "fail" }),
      treeHash: async () => "constant", // never changes → stalls
    });
    expect(result.status).toBe("stalled");
    expect(result.iterations).toBe(2);
  });

  it("treats malformed gate output as 'not ready, keep going'", async () => {
    let phase = 0;
    const run: RunSubagentFn = async (args) => {
      if (args.outputSchema) return "not json at all"; // gate returns garbage
      phase++;
      return "work";
    };
    const result = await runAutopilotSession({
      goal: "g",
      projectRoot: "/tmp/x",
      maxIterations: 1,
      maxStalls: 5,
      runSubagent: run,
      log: () => {},
      verify: async () => ({ passed: true, summary: "ok" }),
      treeHash: async () => "h",
    });
    expect(result.status).toBe("max_iterations");
    expect(result.reports[0].productionReady).toBe(false);
    expect(result.reports[0].remaining.length).toBeGreaterThan(0);
  });
});
