/**
 * V7 — stable, documented exit codes for headless/CI use.
 *
 * These are part of the 1.0 stability contract: scripts and CI pipelines key
 * off them, so numeric values MUST NOT change in a semver-compatible release.
 * New codes may be APPENDED only with a minor bump + CHANGELOG entry.
 *
 *   0   SUCCESS          task finished normally (final answer or no more work)
 *   1   AGENT_ERROR      the agent run itself failed (provider/model/tool crash)
 *   2   CONFIG_ERROR     bad configuration (unknown provider, missing API key,
 *                        malformed sentinel.json) — fixable without code changes
 *   3   MAX_ROUNDS       the agent hit its --max-steps ceiling without finishing
 *   4   HOOK_BLOCKED     a blocking hook vetoed the run (e.g. pre-tool hook
 *                        failed a lint/test gate) — the pre-commit DoD
 *   130 ABORTED          interrupted by SIGINT (128 + SIGINT(2), unix convention)
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  AGENT_ERROR: 1,
  CONFIG_ERROR: 2,
  MAX_ROUNDS: 3,
  HOOK_BLOCKED: 4,
  ABORTED: 130,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** Every stop reason AgentRunner can report (agent-runner.ts). */
export type StopReason =
  | "no_tool_calls"
  | "task_complete"
  | "max_rounds"
  | "aborted"
  | "error"
  | "stuck"
  | "budget_exceeded";

/**
 * Map an agent run's stop reason to its stable exit code.
 *
 * `no_tool_calls` (the model answered without needing more tools) and
 * `task_complete` (self-evaluation confirmed completion) are successes.
 * `stuck`/`budget_exceeded` mean the task did NOT reliably finish, so they
 * surface as AGENT_ERROR — a CI job should fail loudly on both.
 */
export function resolveExitCode(
  stopReason: StopReason,
  opts: { hookBlocked?: boolean } = {}
): ExitCode {
  if (opts.hookBlocked) return EXIT_CODES.HOOK_BLOCKED;
  switch (stopReason) {
    case "no_tool_calls":
    case "task_complete":
      return EXIT_CODES.SUCCESS;
    case "aborted":
      return EXIT_CODES.ABORTED;
    case "max_rounds":
      return EXIT_CODES.MAX_ROUNDS;
    default:
      return EXIT_CODES.AGENT_ERROR;
  }
}

/** Human-readable one-liner per code, for `--help` and error output. */
export const EXIT_CODE_HELP: ReadonlyArray<readonly [number, string]> = [
  [EXIT_CODES.SUCCESS, "task finished normally"],
  [EXIT_CODES.AGENT_ERROR, "agent run failed (provider/tool error, stuck, budget)"],
  [EXIT_CODES.CONFIG_ERROR, "configuration error (provider/key/config)"],
  [EXIT_CODES.MAX_ROUNDS, "max tool rounds reached before finishing"],
  [EXIT_CODES.HOOK_BLOCKED, "a blocking hook vetoed the run"],
  [EXIT_CODES.ABORTED, "interrupted (SIGINT)"],
];
