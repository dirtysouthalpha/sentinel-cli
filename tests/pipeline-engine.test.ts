import { describe, it, expect } from "vitest";
import {
  parsePipeline,
  runPipeline,
  type Pipeline,
  type PipelineStep,
  type PipelineStepResult,
} from "../src/core/pipeline-engine.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("parsePipeline", () => {
  it("parses a valid pipeline", () => {
    const json = JSON.stringify({
      name: "demo",
      steps: [
        { name: "a", prompt: "do a" },
        { name: "b", prompt: "do b", parallel: true },
      ],
    });
    const p = parsePipeline(json);
    expect(p.name).toBe("demo");
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0]).toEqual({ name: "a", prompt: "do a" });
    expect(p.steps[1]).toEqual({ name: "b", prompt: "do b", parallel: true });
  });

  it("throws on invalid JSON", () => {
    expect(() => parsePipeline("{not json")).toThrow(/not valid JSON/i);
  });

  it("throws when top-level is not an object", () => {
    expect(() => parsePipeline("[]")).toThrow(/must be a JSON object/i);
    expect(() => parsePipeline("42")).toThrow(/must be a JSON object/i);
  });

  it("throws when name is missing or empty", () => {
    expect(() => parsePipeline(JSON.stringify({ steps: [] }))).toThrow(/'name' is required/i);
    expect(() => parsePipeline(JSON.stringify({ name: "  ", steps: [] }))).toThrow(
      /'name' is required/i
    );
  });

  it("throws when steps is not an array or is empty", () => {
    expect(() => parsePipeline(JSON.stringify({ name: "x" }))).toThrow(/'steps' is required/i);
    expect(() => parsePipeline(JSON.stringify({ name: "x", steps: [] }))).toThrow(
      /at least one step/i
    );
  });

  it("throws when a step is missing name or prompt", () => {
    expect(() =>
      parsePipeline(JSON.stringify({ name: "x", steps: [{ prompt: "p" }] }))
    ).toThrow(/Step 0 'name' is required/i);
    expect(() =>
      parsePipeline(JSON.stringify({ name: "x", steps: [{ name: "s" }] }))
    ).toThrow(/'prompt' is required/i);
  });

  it("throws when parallel is not a boolean", () => {
    expect(() =>
      parsePipeline(
        JSON.stringify({ name: "x", steps: [{ name: "s", prompt: "p", parallel: "yes" }] })
      )
    ).toThrow(/'parallel' must be a boolean/i);
  });
});

describe("runPipeline", () => {
  it("runs sequential steps in order and passes prior results", async () => {
    const pipeline: Pipeline = {
      name: "seq",
      steps: [
        { name: "one", prompt: "1" },
        { name: "two", prompt: "2" },
        { name: "three", prompt: "3" },
      ],
    };

    const order: string[] = [];
    const priorCounts: number[] = [];
    const runStep = async (step: PipelineStep, prior: PipelineStepResult[]) => {
      order.push(step.name);
      priorCounts.push(prior.length);
      return `done:${step.name}`;
    };

    const results = await runPipeline(pipeline, runStep);

    expect(order).toEqual(["one", "two", "three"]);
    // Each sequential step sees all results before it.
    expect(priorCounts).toEqual([0, 1, 2]);
    expect(results).toEqual([
      { name: "one", result: "done:one" },
      { name: "two", result: "done:two" },
      { name: "three", result: "done:three" },
    ]);
  });

  it("runs a consecutive parallel group concurrently", async () => {
    const pipeline: Pipeline = {
      name: "par",
      steps: [
        { name: "p1", prompt: "a", parallel: true },
        { name: "p2", prompt: "b", parallel: true },
        { name: "p3", prompt: "c", parallel: true },
      ],
    };

    let active = 0;
    let maxActive = 0;
    const runStep = async (step: PipelineStep) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(20);
      active--;
      return step.name;
    };

    const results = await runPipeline(pipeline, runStep);

    // If they ran concurrently, all three were in-flight at the same time.
    expect(maxActive).toBe(3);
    expect(results.map((r) => r.name)).toEqual(["p1", "p2", "p3"]);
  });

  it("members of a parallel group see the same prior snapshot", async () => {
    const pipeline: Pipeline = {
      name: "mix",
      steps: [
        { name: "first", prompt: "f" },
        { name: "p1", prompt: "a", parallel: true },
        { name: "p2", prompt: "b", parallel: true },
        { name: "last", prompt: "l" },
      ],
    };

    const priorByStep: Record<string, number> = {};
    const runStep = async (step: PipelineStep, prior: PipelineStepResult[]) => {
      priorByStep[step.name] = prior.length;
      return step.name;
    };

    const results = await runPipeline(pipeline, runStep);

    expect(priorByStep.first).toBe(0);
    // Both parallel members see only the one prior (first), not each other.
    expect(priorByStep.p1).toBe(1);
    expect(priorByStep.p2).toBe(1);
    // The sequential step after the group sees all three before it.
    expect(priorByStep.last).toBe(3);
    expect(results.map((r) => r.name)).toEqual(["first", "p1", "p2", "last"]);
  });

  it("records a per-step error and continues the rest", async () => {
    const pipeline: Pipeline = {
      name: "err",
      steps: [
        { name: "ok1", prompt: "1" },
        { name: "boom", prompt: "2" },
        { name: "ok2", prompt: "3" },
      ],
    };

    const runStep = async (step: PipelineStep) => {
      if (step.name === "boom") throw new Error("kaboom");
      return `ran:${step.name}`;
    };

    const results = await runPipeline(pipeline, runStep);

    expect(results).toEqual([
      { name: "ok1", result: "ran:ok1" },
      { name: "boom", result: "ERROR: kaboom" },
      { name: "ok2", result: "ran:ok2" },
    ]);
  });

  it("fires onStepStart/onStepEnd hooks", async () => {
    const pipeline: Pipeline = {
      name: "hooks",
      steps: [{ name: "s", prompt: "p" }],
    };
    const started: string[] = [];
    const ended: string[] = [];
    await runPipeline(pipeline, async (s) => s.name, {
      onStepStart: (s) => started.push(s.name),
      onStepEnd: (r) => ended.push(r.name),
    });
    expect(started).toEqual(["s"]);
    expect(ended).toEqual(["s"]);
  });
});
