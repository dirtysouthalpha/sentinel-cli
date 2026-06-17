/**
 * V8 autonomous GSD ("get sh*t done") pipeline.
 *
 * The headline "ship it unattended" capability: given a single task, run a fixed
 * five-phase loop — plan → implement → test → review → fix — where each phase sees
 * the task plus every prior phase's output. After "review", a fix phase runs only
 * when the review signals a problem (failure/error/bug/etc.); otherwise it's
 * skipped so a clean review ships immediately.
 *
 * This module is intentionally PURE: it never touches singletons or a live agent.
 * The per-phase executor (`runPhase`) is injected, which keeps the whole flow
 * unit-testable. The TUI wires `runPhase` to an isolated subagent.
 */

export const GSD_PHASES = ["plan", "implement", "test", "review", "fix"] as const;

export type GsdPhase = (typeof GSD_PHASES)[number];

export interface GsdPhaseResult {
  phase: string;
  output: string;
}

/** Executes one phase given the task and all prior phase outputs. Injected. */
export type RunPhaseFn = (
  phase: string,
  task: string,
  prior: GsdPhaseResult[]
) => Promise<string>;

export interface RunGsdOptions {
  /**
   * Decide whether the "fix" phase should run, given the review output.
   * Default: any of fail/error/bug/broken/todo (word-boundary, case-insensitive).
   */
  needsFix?: (reviewOutput: string) => boolean;
  /** Fired right before a phase is dispatched. */
  onPhaseStart?: (phase: string) => void;
  /** Fired after a phase settles (success or recorded error). */
  onPhaseEnd?: (result: GsdPhaseResult) => void;
}

const DEFAULT_FIX_SIGNAL = /\b(fail|error|bug|broken|todo)\b/i;

/** Per-phase prompt builder. Pure: returns the instruction string for a phase. */
export function buildPhasePrompt(
  phase: string,
  task: string,
  prior: GsdPhaseResult[]
): string {
  const priorBlock = prior.length
    ? "\n\nPrior phase outputs (use these as ground truth):\n" +
      prior.map((p) => `### ${p.phase}\n${p.output}`).join("\n\n")
    : "";

  const instructions: Record<string, string> = {
    plan:
      "You are in the PLAN phase. Analyze the task and produce a concrete, ordered " +
      "implementation plan: the files to touch, the changes to make, and the tests to " +
      "add or update. Do NOT write code yet — output the plan only.",
    implement:
      "You are in the IMPLEMENT phase. Following the plan above, make the actual code " +
      "changes using your tools (read files, apply patches, create files). Implement the " +
      "full task — do not stub or leave TODOs. Report exactly what you changed.",
    test:
      "You are in the TEST phase. Run the project's tests and any relevant checks (build, " +
      "type-check, lint) for the changes just made. Report the commands you ran and their " +
      "results. Clearly state PASS or FAIL and include any failing output.",
    review:
      "You are in the REVIEW phase. Critically review the implementation and test results " +
      "above for correctness, completeness, regressions, and missed requirements. If " +
      "everything is correct and complete, say so explicitly. If there is any problem, " +
      "describe it and use the words fail/error/bug as appropriate so it can be fixed.",
    fix:
      "You are in the FIX phase. The review found problems. Address every issue raised in " +
      "the review by making the necessary code changes with your tools, then re-verify. " +
      "Report what you fixed and confirm the task is now complete.",
  };

  const phaseInstruction =
    instructions[phase] ??
    `You are in the ${phase.toUpperCase()} phase. Complete this phase for the task.`;

  return `Task:\n${task}\n\n${phaseInstruction}${priorBlock}`;
}

/**
 * Run the autonomous GSD pipeline.
 *
 * Phases run in order (plan → implement → test → review), each receiving the task
 * plus all prior phase outputs. After review, "fix" runs only if `needsFix` (or
 * the default failure-signal regex) matches the review output. A phase that throws
 * is recorded as an `ERROR: ...` output and the pipeline continues.
 *
 * Returns one `{ phase, output }` per phase that ran, in execution order.
 */
export async function runGsd(
  task: string,
  runPhase: RunPhaseFn,
  opts: RunGsdOptions = {}
): Promise<GsdPhaseResult[]> {
  const needsFix = opts.needsFix ?? ((out: string) => DEFAULT_FIX_SIGNAL.test(out));
  const results: GsdPhaseResult[] = [];

  const runOne = async (phase: string): Promise<GsdPhaseResult> => {
    opts.onPhaseStart?.(phase);
    let res: GsdPhaseResult;
    try {
      const output = await runPhase(phase, task, results.slice());
      res = { phase, output };
    } catch (err) {
      res = {
        phase,
        output: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    opts.onPhaseEnd?.(res);
    return res;
  };

  for (const phase of GSD_PHASES) {
    if (phase === "fix") {
      const review = results.find((r) => r.phase === "review");
      // Only run fix when the review signals a problem (and didn't itself error out).
      if (!review || review.output.startsWith("ERROR:") || !needsFix(review.output)) {
        continue;
      }
    }
    results.push(await runOne(phase));
  }

  return results;
}
