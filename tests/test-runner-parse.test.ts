import { describe, it, expect } from "vitest";
import { parseTestRunnerOutput } from "../src/core/test-runner-parse.js";

describe("parseTestRunnerOutput — structured pass/fail from runner output", () => {
  it("parses a passing run (exit 0)", () => {
    const r = parseTestRunnerOutput("5 passed", 0);
    expect(r.passed).toBe(true);
    expect(r.passCount).toBe(5);
    expect(r.failCount).toBe(0);
    expect(r.failures).toEqual([]);
  });
  it("parses a failing run (exit 1) with failure messages", () => {
    const out = "FAIL tests/foo.test.ts\n  ● foo > bar (3 ms)\n\n  Expected: 5\n  Received: 3\n\nTests: 1 failed, 4 passed, 5 total";
    const r = parseTestRunnerOutput(out, 1);
    expect(r.passed).toBe(false);
    expect(r.failCount).toBe(1);
    expect(r.passCount).toBe(4);
    expect(r.failures[0]).toContain("foo > bar");
  });
  it("extracts multiple failure descriptions", () => {
    const out = "FAIL a.test.ts\n  ● a > x\nFAIL b.test.ts\n  ● b > y\nTests: 2 failed, 3 passed";
    const r = parseTestRunnerOutput(out, 1);
    expect(r.failCount).toBe(2);
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0]).toContain("a > x");
    expect(r.failures[1]).toContain("b > y");
  });
  it("handles exit code alone (no parseable counts)", () => {
    expect(parseTestRunnerOutput("garbage output", 1).passed).toBe(false);
    expect(parseTestRunnerOutput("garbage output", 0).passed).toBe(true);
  });
  it("treats a crash (exit > 1) as failed with the output as the failure", () => {
    const r = parseTestRunnerOutput("SyntaxError: unexpected token", 2);
    expect(r.passed).toBe(false);
    expect(r.failures[0]).toContain("SyntaxError");
  });
  it("parses vitest/jest 'X failed, Y passed' format", () => {
    const r = parseTestRunnerOutput("Tests  3 failed | 7 passed", 1);
    expect(r.failCount).toBe(3);
    expect(r.passCount).toBe(7);
  });
  it("parses pytest 'X failed, Y passed' format", () => {
    const r = parseTestRunnerOutput("2 failed, 8 passed in 1.5s", 1);
    expect(r.failCount).toBe(2);
    expect(r.passCount).toBe(8);
  });
  it("empty output + exit 0 = passed with 0 tests", () => {
    const r = parseTestRunnerOutput("", 0);
    expect(r.passed).toBe(true);
    expect(r.passCount).toBe(0);
  });
});
