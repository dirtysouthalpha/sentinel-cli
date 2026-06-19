/**
 * parseTestRunnerOutput — pure structured pass/fail extraction from test output.
 *
 * Feeds real test-runner exit codes + stdout into the GSD `fix` gate (instead of
 * the old prose-regex approach). Supports vitest/jest "N failed | M passed" and
 * pytest "N failed, M passed" formats, plus failure-description extraction.
 *
 * Pure: no I/O, no subprocess. Fully tested.
 */

export interface TestRunResult {
  passed: boolean;
  passCount: number;
  failCount: number;
  /** One string per failure, with the test name + assertion line. */
  failures: string[];
}

/** Parse test runner stdout + exit code into a structured result. */
export function parseTestRunnerOutput(stdout: string, exitCode: number): TestRunResult {
  const failed = exitCode !== 0;
  const text = stdout.trim();

  // Extract failure descriptions: "● test > case" lines (jest/vitest format).
  const failures: string[] = [];
  const failMatch = text.matchAll(/[●✕✗]\s+(.+?)(?:\n|$)/g);
  for (const m of failMatch) {
    if (m[1].trim()) failures.push(m[1].trim());
  }
  // pytest "FAILED test::case" format.
  const pytestFails = text.matchAll(/FAILED\s+(\S+)/g);
  for (const m of pytestFails) {
    if (m[1].trim()) failures.push(m[1].trim());
  }

  // Extract counts: "N failed | M passed" (vitest), "N failed, M passed" (pytest/jest).
  let failCount = 0;
  let passCount = 0;
  const vitestCounts = text.match(/(\d+)\s*failed\s*[|,]\s*(\d+)\s*passed/i);
  if (vitestCounts) {
    failCount = parseInt(vitestCounts[1], 10);
    passCount = parseInt(vitestCounts[2], 10);
  } else {
    const f = text.match(/(\d+)\s*failed/i);
    const p = text.match(/(\d+)\s*passed/i);
    if (f) failCount = parseInt(f[1], 10);
    if (p) passCount = parseInt(p[1], 10);
  }

  // A crash (exit > 1) with no parseable counts: treat the output as the failure.
  if (exitCode > 1 && failCount === 0 && failures.length === 0 && text) {
    failures.push(text.slice(0, 500));
  }

  return {
    passed: !failed,
    passCount,
    failCount,
    failures,
  };
}
