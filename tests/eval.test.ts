import { describe, it, expect } from "vitest";
import { evaluateCheck, evaluateTask, summarize, type EvalContext, type EvalTask } from "../src/core/eval.js";

function ctx(output: string, files: Record<string, string> = {}): EvalContext {
  return {
    output,
    fileExists: (p) => p in files,
    readFile: (p) => (p in files ? files[p] : null),
  };
}

describe("evaluateCheck", () => {
  it("outputContains is case-insensitive by default", () => {
    expect(evaluateCheck({ type: "outputContains", value: "Done" }, ctx("task done")).passed).toBe(true);
  });

  it("outputContains respects caseSensitive", () => {
    expect(evaluateCheck({ type: "outputContains", value: "Done", caseSensitive: true }, ctx("task done")).passed).toBe(false);
  });

  it("outputOmits passes when the string is absent", () => {
    expect(evaluateCheck({ type: "outputOmits", value: "error" }, ctx("all good")).passed).toBe(true);
    expect(evaluateCheck({ type: "outputOmits", value: "error" }, ctx("an error occurred")).passed).toBe(false);
  });

  it("fileExists / fileContains read through the injected fs", () => {
    const c = ctx("", { "out.txt": "hello world" });
    expect(evaluateCheck({ type: "fileExists", path: "out.txt" }, c).passed).toBe(true);
    expect(evaluateCheck({ type: "fileExists", path: "missing.txt" }, c).passed).toBe(false);
    expect(evaluateCheck({ type: "fileAbsent", path: "missing.txt" }, c).passed).toBe(true);
    expect(evaluateCheck({ type: "fileAbsent", path: "out.txt" }, c).passed).toBe(false);
    expect(evaluateCheck({ type: "fileContains", path: "out.txt", value: "WORLD" }, c).passed).toBe(true);
    expect(evaluateCheck({ type: "fileContains", path: "missing.txt", value: "x" }, c).passed).toBe(false);
  });
});

describe("evaluateTask", () => {
  const task: EvalTask = {
    id: "t1",
    prompt: "do the thing",
    checks: [
      { type: "outputContains", value: "ok" },
      { type: "fileExists", path: "result.txt" },
    ],
  };

  it("passes only when every check passes", () => {
    const pass = evaluateTask(task, ctx("ok", { "result.txt": "x" }));
    expect(pass.passed).toBe(true);
    const fail = evaluateTask(task, ctx("ok", {})); // missing file
    expect(fail.passed).toBe(false);
  });

  it("fails (regardless of checks) when the run errored", () => {
    const r = evaluateTask(task, ctx("ok", { "result.txt": "x" }), { error: "agent crashed" });
    expect(r.passed).toBe(false);
    expect(r.error).toBe("agent crashed");
  });

  it("a task with no checks does not vacuously pass", () => {
    expect(evaluateTask({ id: "empty", prompt: "x", checks: [] }, ctx("")).passed).toBe(false);
  });
});

describe("summarize", () => {
  it("counts and computes pass rate", () => {
    const s = summarize([
      { id: "a", passed: true, checks: [] },
      { id: "b", passed: false, checks: [] },
      { id: "c", passed: true, checks: [] },
    ]);
    expect(s).toEqual({ total: 3, passed: 2, failed: 1, passRate: 0.667 });
  });

  it("handles an empty result set", () => {
    expect(summarize([])).toEqual({ total: 0, passed: 0, failed: 0, passRate: 0 });
  });
});
