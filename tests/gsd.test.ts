import { describe, it, expect } from "vitest";
import {
  GSD_PHASES,
  runGsd,
  buildPhasePrompt,
  type GsdPhaseResult,
} from "../src/core/gsd.js";

describe("GSD_PHASES", () => {
  it("is the canonical 5-phase order", () => {
    expect(GSD_PHASES).toEqual(["plan", "implement", "test", "review", "fix"]);
  });
});

describe("runGsd", () => {
  it("runs the 4 base phases in order with prior outputs threaded, skipping fix on a clean review", async () => {
    const seen: { phase: string; priorPhases: string[] }[] = [];
    const results = await runGsd("build a widget", async (phase, _task, prior) => {
      seen.push({ phase, priorPhases: prior.map((p) => p.phase) });
      return `${phase}-done`;
    });

    // Clean review (no failure signal) → fix is skipped.
    expect(results.map((r) => r.phase)).toEqual(["plan", "implement", "test", "review"]);
    expect(results.map((r) => r.output)).toEqual([
      "plan-done",
      "implement-done",
      "test-done",
      "review-done",
    ]);

    // Each phase saw exactly the prior phases' outputs, in order.
    expect(seen.map((s) => s.priorPhases)).toEqual([
      [],
      ["plan"],
      ["plan", "implement"],
      ["plan", "implement", "test"],
    ]);
  });

  it("threads the actual prior outputs (not just names) into each phase", async () => {
    const priorOutputsAtTest: string[] = [];
    await runGsd("task", async (phase, _task, prior) => {
      if (phase === "test") priorOutputsAtTest.push(...prior.map((p) => p.output));
      return `${phase}:ok`;
    });
    expect(priorOutputsAtTest).toEqual(["plan:ok", "implement:ok"]);
  });

  it("runs the fix phase when the review signals a failure", async () => {
    const results = await runGsd("task", async (phase) => {
      if (phase === "review") return "Found a bug in the parser.";
      return `${phase}-done`;
    });
    expect(results.map((r) => r.phase)).toEqual([
      "plan",
      "implement",
      "test",
      "review",
      "fix",
    ]);
  });

  it("passes the review (and all prior) output to the fix phase", async () => {
    let fixPrior: GsdPhaseResult[] = [];
    await runGsd("task", async (phase, _task, prior) => {
      if (phase === "fix") fixPrior = prior;
      if (phase === "review") return "error: tests failed";
      return `${phase}-done`;
    });
    expect(fixPrior.map((p) => p.phase)).toEqual(["plan", "implement", "test", "review"]);
    expect(fixPrior.find((p) => p.phase === "review")?.output).toBe("error: tests failed");
  });

  it("honors a custom needsFix predicate", async () => {
    const runWith = (needsFix: (s: string) => boolean) =>
      runGsd(
        "task",
        async (phase) => (phase === "review" ? "REVIEW_VERDICT=REJECT" : `${phase}-done`),
        { needsFix }
      );

    const ran = await runWith((out) => out.includes("REJECT"));
    expect(ran.some((r) => r.phase === "fix")).toBe(true);

    // The default regex would NOT trigger on "REJECT", so without the custom
    // predicate fix is skipped — proving the predicate is what drove it.
    const skipped = await runWith(() => false);
    expect(skipped.some((r) => r.phase === "fix")).toBe(false);
  });

  it("does not abort when a phase throws — it records the error and continues", async () => {
    const results = await runGsd("task", async (phase) => {
      if (phase === "implement") throw new Error("boom");
      return `${phase}-done`;
    });
    expect(results.map((r) => r.phase)).toEqual(["plan", "implement", "test", "review"]);
    const impl = results.find((r) => r.phase === "implement");
    expect(impl?.output).toMatch(/^ERROR: boom/);
  });

  it("skips fix when the review phase itself errored", async () => {
    const results = await runGsd("task", async (phase) => {
      if (phase === "review") throw new Error("review crashed");
      return `${phase}-done`;
    });
    expect(results.some((r) => r.phase === "fix")).toBe(false);
    expect(results.find((r) => r.phase === "review")?.output).toMatch(/^ERROR:/);
  });

  it("fires onPhaseStart/onPhaseEnd hooks", async () => {
    const started: string[] = [];
    const ended: string[] = [];
    await runGsd("task", async (phase) => `${phase}-done`, {
      onPhaseStart: (p) => started.push(p),
      onPhaseEnd: (r) => ended.push(r.phase),
    });
    expect(started).toEqual(["plan", "implement", "test", "review"]);
    expect(ended).toEqual(["plan", "implement", "test", "review"]);
  });
});

describe("buildPhasePrompt", () => {
  it("includes the task and a phase-specific instruction", () => {
    const p = buildPhasePrompt("plan", "implement feature X", []);
    expect(p).toContain("implement feature X");
    expect(p).toContain("PLAN phase");
    // No prior block when there is no prior context.
    expect(p).not.toContain("Prior phase outputs");
  });

  it("includes prior phase context when present", () => {
    const prior: GsdPhaseResult[] = [
      { phase: "plan", output: "the plan body" },
      { phase: "implement", output: "the code changes" },
    ];
    const p = buildPhasePrompt("test", "do the thing", prior);
    expect(p).toContain("do the thing");
    expect(p).toContain("TEST phase");
    expect(p).toContain("Prior phase outputs");
    expect(p).toContain("### plan");
    expect(p).toContain("the plan body");
    expect(p).toContain("### implement");
    expect(p).toContain("the code changes");
  });

  it("produces a distinct instruction for every phase", () => {
    const instructions = GSD_PHASES.map((ph) => buildPhasePrompt(ph, "t", []));
    const unique = new Set(instructions);
    expect(unique.size).toBe(GSD_PHASES.length);
    for (const ph of GSD_PHASES) {
      expect(buildPhasePrompt(ph, "t", [])).toContain(`${ph.toUpperCase()} phase`);
    }
  });
});
