import { describe, it, expect } from "vitest";
import { EXIT_CODES, EXIT_CODE_HELP, resolveExitCode } from "../src/core/exit-codes.js";
import type { StopReason } from "../src/core/exit-codes.js";

describe("stable exit codes (V7 / 1.0 contract)", () => {
  it("pins the numeric values — scripts and CI key off them", () => {
    // These values are semver-frozen as of 1.0. If this test fails, a breaking
    // change to the CLI contract slipped in.
    expect(EXIT_CODES.SUCCESS).toBe(0);
    expect(EXIT_CODES.AGENT_ERROR).toBe(1);
    expect(EXIT_CODES.CONFIG_ERROR).toBe(2);
    expect(EXIT_CODES.MAX_ROUNDS).toBe(3);
    expect(EXIT_CODES.HOOK_BLOCKED).toBe(4);
    expect(EXIT_CODES.ABORTED).toBe(130); // 128 + SIGINT(2), unix convention
  });

  it("maps every stop reason to a code", () => {
    const cases: Array<[StopReason, number]> = [
      ["no_tool_calls", 0],
      ["task_complete", 0],
      ["aborted", 130],
      ["max_rounds", 3],
      ["error", 1],
      ["stuck", 1],
      ["budget_exceeded", 1],
    ];
    for (const [reason, code] of cases) {
      expect(resolveExitCode(reason), `stopReason=${reason}`).toBe(code);
    }
  });

  it("documents every code in --help output", () => {
    const documented: Record<number, true> = {};
    for (const [code] of EXIT_CODE_HELP) documented[code] = true;
    for (const code of Object.values(EXIT_CODES)) {
      expect(documented[code], `code ${code} documented`).toBe(true);
    }
    expect(EXIT_CODE_HELP.length).toBe(Object.keys(EXIT_CODES).length);
  });
});
