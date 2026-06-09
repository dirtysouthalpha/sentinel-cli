/**
 * Autonomous "ralph loop" engine. Repeatedly runs an iteration (a full GSD cycle
 * + verification + a readiness gate) until the project is production-ready, the
 * iteration budget is spent, or the loop stalls (stops making changes). It is
 * the set-and-forget orchestrator: kick it off, walk away, come back to a
 * finished app — with hard safety bounds so it can never spin forever.
 *
 * PURE: the per-iteration work (`runIteration`) is injected, so the loop's
 * stop/continue/stall logic is fully unit-testable without a live agent.
 */

export type AutopilotStatus =
  | "production_ready"
  | "max_iterations"
  | "stalled"
  | "aborted"
  | "budget_exhausted";

/** What one iteration of the loop reports back. */
export interface IterationReport {
  iteration: number;
  /** Human-readable summary of what this iteration did. */
  summary: string;
  /** Deterministic gate: did lint/test/build (etc.) all pass? */
  checksPassed: boolean;
  /** The model gate's verdict: is the goal fully delivered? */
  productionReady: boolean;
  /** Outstanding work items the gate still wants done. */
  remaining: string[];
  /** Did this iteration change the working tree? Drives stall detection. */
  changed: boolean;
}

export interface AutopilotOptions {
  /** Hard cap on iterations (>=1). */
  maxIterations: number;
  /** Consecutive no-change iterations tolerated before declaring a stall (>=1). */
  maxStalls: number;
  /** Reports from a prior interrupted run to resume from (iteration numbering and
   *  the stall counter continue from here). */
  priorReports?: IterationReport[];
  /** Called after each iteration with the full reports list — for checkpointing. */
  onIteration?: (reports: IterationReport[]) => void | Promise<void>;
  /** Checked before each iteration; return a terminal status (e.g. budget_exhausted)
   *  to stop the loop early. */
  preflight?: () => AutopilotStatus | null;
}

/** Count consecutive no-change iterations at the tail (for resuming the stall counter). */
function trailingStalls(reports: IterationReport[]): number {
  let n = 0;
  for (let i = reports.length - 1; i >= 0 && !reports[i].changed; i--) n++;
  return n;
}

export interface AutopilotResult {
  status: AutopilotStatus;
  iterations: number;
  reports: IterationReport[];
}

/** A project is complete only when the deterministic checks pass, the model gate
 *  says production-ready, and nothing remains. All three must agree. */
export function isComplete(r: IterationReport): boolean {
  return r.checksPassed && r.productionReady && r.remaining.length === 0;
}

/**
 * Drive the autonomous loop. Stops on the first complete iteration, after
 * `maxStalls` consecutive no-change iterations, when `maxIterations` is reached,
 * or as soon as `isAborted()` returns true (checked before each iteration).
 */
export async function runAutopilot(
  runIteration: (iteration: number, prior: IterationReport[]) => Promise<IterationReport>,
  options: AutopilotOptions,
  isAborted: () => boolean = () => false
): Promise<AutopilotResult> {
  const maxIterations = Math.max(1, Math.floor(options.maxIterations));
  const maxStalls = Math.max(1, Math.floor(options.maxStalls));
  const reports: IterationReport[] = [...(options.priorReports ?? [])];
  let stalls = trailingStalls(reports);
  const done = (status: AutopilotStatus): AutopilotResult => ({ status, iterations: reports.length, reports });

  for (let i = reports.length + 1; i <= maxIterations; i++) {
    if (isAborted()) return done("aborted");
    const early = options.preflight?.();
    if (early) return done(early);

    const report = await runIteration(i, reports.slice());
    reports.push(report);
    await options.onIteration?.(reports.slice());

    if (isComplete(report)) return done("production_ready");

    stalls = report.changed ? 0 : stalls + 1;
    if (stalls >= maxStalls) return done("stalled");
  }

  return done("max_iterations");
}

/** One-line human summary of a finished run, for surfacing in the UI/logs. */
export function summarizeAutopilot(result: AutopilotResult): string {
  const last = result.reports[result.reports.length - 1];
  const remaining = last?.remaining ?? [];
  switch (result.status) {
    case "production_ready":
      return `✅ Production-ready after ${result.iterations} iteration(s) — all checks pass and the gate is satisfied.`;
    case "stalled":
      return `⏸ Stalled after ${result.iterations} iteration(s) — no further changes were being made. Remaining:\n- ${remaining.join("\n- ") || "(unspecified)"}`;
    case "aborted":
      return `■ Stopped by you after ${result.iterations} iteration(s).`;
    case "max_iterations":
      return `🔁 Hit the ${result.iterations}-iteration budget without reaching production-ready. Remaining:\n- ${remaining.join("\n- ") || "(unspecified)"}`;
    case "budget_exhausted":
      return `💸 Stopped after ${result.iterations} iteration(s) — cost/time ceiling reached. Resume with --resume. Remaining:\n- ${remaining.join("\n- ") || "(unspecified)"}`;
  }
}
