/**
 * Agent-level evaluation primitives. Sentinel has unit tests for its parts, but
 * nothing that measures whether the *agent* actually completes a task — so a
 * prompt/model/router change can regress behavior silently. This module is the
 * scorable core: pure, I/O-injected check evaluation that the runnable harness
 * (`evals/run.mjs`) and the unit tests (`tests/eval.test.ts`) both build on.
 *
 * Deterministic checks only here (did the file get written, does the output
 * contain X). An optional LLM-judge rubric layers on top in the harness.
 */

export type EvalCheck =
  | { type: "outputContains"; value: string; caseSensitive?: boolean }
  | { type: "outputOmits"; value: string; caseSensitive?: boolean }
  | { type: "fileExists"; path: string }
  | { type: "fileAbsent"; path: string }
  | { type: "fileContains"; path: string; value: string; caseSensitive?: boolean };

export interface EvalTask {
  id: string;
  prompt: string;
  /** Files to seed the working dir with before the run (relative path -> content). */
  fixture?: Record<string, string>;
  checks: EvalCheck[];
}

export interface CheckResult {
  check: EvalCheck;
  passed: boolean;
  detail: string;
}

export interface TaskResult {
  id: string;
  passed: boolean;
  checks: CheckResult[];
  durationMs?: number;
  error?: string;
}

/** Injected filesystem view so check evaluation stays pure and unit-testable. */
export interface EvalContext {
  output: string;
  readFile: (path: string) => string | null;
  fileExists: (path: string) => boolean;
}

function contains(haystack: string, needle: string, caseSensitive?: boolean): boolean {
  if (caseSensitive) return haystack.includes(needle);
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Evaluate one check against a run context. Pure — no real I/O. */
export function evaluateCheck(check: EvalCheck, ctx: EvalContext): CheckResult {
  switch (check.type) {
    case "outputContains": {
      const passed = contains(ctx.output, check.value, check.caseSensitive);
      return { check, passed, detail: passed ? `output contains "${check.value}"` : `output missing "${check.value}"` };
    }
    case "outputOmits": {
      const passed = !contains(ctx.output, check.value, check.caseSensitive);
      return { check, passed, detail: passed ? `output omits "${check.value}"` : `output unexpectedly contains "${check.value}"` };
    }
    case "fileExists": {
      const passed = ctx.fileExists(check.path);
      return { check, passed, detail: passed ? `${check.path} exists` : `${check.path} not found` };
    }
    case "fileAbsent": {
      const passed = !ctx.fileExists(check.path);
      return { check, passed, detail: passed ? `${check.path} absent (as expected)` : `${check.path} was unexpectedly created` };
    }
    case "fileContains": {
      const body = ctx.readFile(check.path);
      if (body == null) return { check, passed: false, detail: `${check.path} not found` };
      const passed = contains(body, check.value, check.caseSensitive);
      return { check, passed, detail: passed ? `${check.path} contains "${check.value}"` : `${check.path} missing "${check.value}"` };
    }
  }
}

/** Evaluate all of a task's checks. A task passes only if every check passes. */
export function evaluateTask(task: EvalTask, ctx: EvalContext, meta?: { durationMs?: number; error?: string }): TaskResult {
  const checks = task.checks.map((c) => evaluateCheck(c, ctx));
  return {
    id: task.id,
    passed: checks.length > 0 && checks.every((c) => c.passed) && !meta?.error,
    checks,
    durationMs: meta?.durationMs,
    error: meta?.error,
  };
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

export function summarize(results: TaskResult[]): EvalSummary {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 0 : Math.round((passed / total) * 1000) / 1000,
  };
}
