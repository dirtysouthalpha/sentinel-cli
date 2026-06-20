/**
 * The autonomous-loop orchestration, shared by the TUI (`/autopilot`) and the
 * headless CLI (`sentinel autopilot`). Each iteration runs a full GSD cycle, then
 * gates on BOTH a deterministic check (lint/test/build) and a strict, schema-
 * validated model verdict, feeding the remaining work into the next iteration —
 * until production-ready, the budget is spent, or it stalls.
 *
 * The side-effecting seams (running a subagent, the verify checks, the working-
 * tree hash) are injected, which keeps the whole orchestration unit-testable
 * end-to-end with fakes — no network, no subprocess.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { runAutopilot, summarizeAutopilot, type AutopilotStatus, type IterationReport, type AutopilotResult } from "./autopilot.js";
import { runGsd, buildPhasePrompt } from "./gsd.js";
import { resolveVerifyCommands, runVerifyCommands, workingTreeHash, gitCommitAll, type VerifyResult } from "./verify.js";

/** Persisted progress so an interrupted run resumes across crashes/restarts. */
export interface AutopilotCheckpoint {
  goal: string;
  currentGoal: string;
  reports: IterationReport[];
}

/** Default checkpoint location for a project. */
export function checkpointPath(projectRoot: string): string {
  return join(projectRoot, ".sentinel", "autopilot.json");
}

function loadCheckpointFile(projectRoot: string): AutopilotCheckpoint | null {
  try {
    const p = checkpointPath(projectRoot);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as AutopilotCheckpoint;
  } catch {
    return null;
  }
}

function saveCheckpointFile(projectRoot: string, cp: AutopilotCheckpoint): void {
  try {
    const p = checkpointPath(projectRoot);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(cp, null, 2));
  } catch {
    // best-effort — never let a failed checkpoint write abort the run
  }
}

function clearCheckpointFile(projectRoot: string): void {
  try {
    rmSync(checkpointPath(projectRoot), { force: true });
  } catch {
    // ignore
  }
}

/** Runs one subagent task; forwards the abort signal. Returns the subagent's
 *  final text (or pretty JSON when an outputSchema is supplied). */
export type RunSubagentFn = (
  args: { task: string; context?: string; outputSchema?: Record<string, unknown> },
  signal?: AbortSignal
) => Promise<string>;

export interface AutopilotSessionDeps {
  goal: string;
  projectRoot: string;
  maxIterations: number;
  maxStalls: number;
  /** Explicit verify-command override; otherwise auto-detected from package.json. */
  verifyCommands?: string[];
  runSubagent: RunSubagentFn;
  signal?: AbortSignal;
  log: (msg: string) => void;
  /** Stop once cumulative cost (via costSpent) reaches this many USD. */
  maxCostUSD?: number;
  /** Stop once this many wall-clock minutes have elapsed. */
  maxMinutes?: number;
  /** Cumulative spend so far (USD). Required for the cost ceiling to apply. */
  costSpent?: () => number;
  /** Resume from a saved checkpoint for this goal if one exists. */
  resume?: boolean;
  /** Test seams (default to the real implementations). */
  verify?: (commands: string[]) => Promise<VerifyResult>;
  treeHash?: () => Promise<string | null>;
  now?: () => number;
  /** Commit the working tree after each changed iteration (atomic, revertable
   *  history). Default: git add -A && git commit. Pass () => Promise.resolve(false) to disable. */
  commit?: (message: string) => Promise<boolean>;
  loadCheckpoint?: () => AutopilotCheckpoint | null;
  saveCheckpoint?: (cp: AutopilotCheckpoint) => void;
  clearCheckpoint?: () => void;
}

const GATE_SCHEMA = {
  type: "object",
  required: ["productionReady", "remaining", "summary"],
  properties: {
    productionReady: { type: "boolean" },
    remaining: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
} as const;

function gatePrompt(goal: string, projectRoot: string, cycleSummary: string, verify: VerifyResult): string {
  return (
    `You are the AUTOPILOT PRODUCTION GATE for the project at ${projectRoot}.\n\n` +
    `GOAL:\n${goal}\n\nLatest build cycle:\n${cycleSummary}\n\n` +
    `Deterministic checks: ${verify.passed ? "ALL PASSED" : "FAILED — " + verify.summary}\n\n` +
    `Decide STRICTLY whether the goal is fully delivered and production-ready. Production-ready means: the goal ` +
    `is completely met, all checks pass, there are NO TODOs/stubs/placeholders and no known bugs. If ANY of that ` +
    `is untrue it is NOT production-ready — list every remaining work item concretely and actionably so the next ` +
    `iteration can finish it.`
  );
}

export async function runAutopilotSession(deps: AutopilotSessionDeps): Promise<AutopilotResult> {
  const { goal, projectRoot, maxIterations, maxStalls, runSubagent, signal, log } = deps;
  const isAborted = () => !!signal?.aborted;
  const commands = resolveVerifyCommands(projectRoot, deps.verifyCommands);
  const verify = deps.verify ?? ((cmds: string[]) => runVerifyCommands(projectRoot, cmds, isAborted));
  const treeHash = deps.treeHash ?? (() => workingTreeHash(projectRoot));
  const now = deps.now ?? (() => globalThis.Date.now());
  const load = deps.loadCheckpoint ?? (() => loadCheckpointFile(projectRoot));
  const save = deps.saveCheckpoint ?? ((cp: AutopilotCheckpoint) => saveCheckpointFile(projectRoot, cp));
  const clear = deps.clearCheckpoint ?? (() => clearCheckpointFile(projectRoot));
  const commit = deps.commit ?? ((msg: string) => gitCommitAll(projectRoot, msg));

  let currentGoal = goal;
  let priorReports: IterationReport[] = [];
  if (deps.resume) {
    const cp = load();
    if (cp && cp.goal === goal && cp.reports.length) {
      priorReports = cp.reports;
      currentGoal = cp.currentGoal || goal;
      log(`Resuming autopilot from checkpoint: ${cp.reports.length} prior iteration(s).`);
    }
  }

  // Cost/time ceiling: checked before each iteration.
  const startMs = now();
  const preflight = (): AutopilotStatus | null => {
    if (deps.maxMinutes && (now() - startMs) / 60000 >= deps.maxMinutes) return "budget_exhausted";
    if (deps.maxCostUSD && deps.costSpent && deps.costSpent() >= deps.maxCostUSD) return "budget_exhausted";
    return null;
  };

  log(
    `Autopilot: grinding toward production-ready (up to ${maxIterations} iterations; ` +
      `gate: ${commands.length ? commands.join(" && ") : "model-only"}` +
      `${deps.maxMinutes ? `; ≤${deps.maxMinutes}min` : ""}${deps.maxCostUSD ? `; ≤$${deps.maxCostUSD}` : ""}).`
  );

  const result = await runAutopilot(
    async (iteration): Promise<IterationReport> => {
      log(`\n━━━ Autopilot iteration ${iteration}/${maxIterations} ━━━`);
      const before = await treeHash();

      // 1) Full GSD cycle on the current goal.
      const phases = await runGsd(
        currentGoal,
        async (phase, t, prior) => {
          if (isAborted()) return "ERROR: cancelled";
          return runSubagent({ task: buildPhasePrompt(phase, t, prior) }, signal);
        },
        { onPhaseStart: (ph) => log(`  • ${ph}...`) }
      );
      const cycleSummary = phases
        .map((p) => `${p.phase}: ${p.output.split("\n")[0].slice(0, 160)}`)
        .join("\n");

      // 2) Deterministic gate.
      const v = await verify(commands);
      log(`  ${v.passed ? "✓ checks PASS" : "✗ checks FAIL"} — ${v.summary}`);

      // 3) Strict model gate.
      let productionReady = false;
      let remaining: string[] = [];
      let summary = cycleSummary;
      try {
        const verdictRaw = await runSubagent(
          { task: gatePrompt(goal, projectRoot, cycleSummary, v), outputSchema: GATE_SCHEMA as unknown as Record<string, unknown> },
          signal
        );
        const verdict = JSON.parse(verdictRaw) as { productionReady?: boolean; remaining?: unknown; summary?: string };
        productionReady = !!verdict.productionReady;
        remaining = Array.isArray(verdict.remaining) ? verdict.remaining.map(String) : [];
        summary = verdict.summary || cycleSummary;
      } catch {
        remaining = ["production gate did not return a usable verdict — continuing"];
      }

      // Strict: a "ready" verdict only counts if the checks actually pass.
      const reallyReady = productionReady && v.passed;
      log(`  gate: ${reallyReady ? "PRODUCTION-READY" : "not yet"}${remaining.length ? ` — ${remaining.length} item(s) remaining` : ""}`);

      if (!reallyReady && remaining.length) {
        currentGoal = `${goal}\n\nStill required to be production-ready — complete ALL of it:\n- ` + remaining.join("\n- ");
      } else if (!reallyReady && !v.passed) {
        currentGoal = `${goal}\n\nThe verification checks are failing:\n${v.summary}\nFix them.`;
      }

      const after = await treeHash();
      const changed = before == null || after == null ? true : before !== after;

      // Per-iteration atomic commit so each step is a revertable point in history.
      // CRITICAL: only commit GREEN iterations. Committing a red iteration (failed
      // lint/test/build) accumulates broken commits — the loop then spends every
      // subsequent iteration fighting the breakage instead of making progress,
      // spiraling. On failure, leave the working tree dirty so the next iteration
      // fixes forward from the last known-good commit.
      if (changed && v.passed) {
        const committed = await commit(`autopilot[${iteration}] ${summary.split("\n")[0].slice(0, 100)}`);
        if (committed) log(`  ✓ committed iteration ${iteration}`);
      } else if (changed && !v.passed) {
        log(`  ⊘ skipped commit (checks failed — working tree left dirty for next iteration)`);
      }

      return { iteration, summary, checksPassed: v.passed, productionReady: reallyReady, remaining, changed };
    },
    {
      maxIterations,
      maxStalls,
      priorReports,
      preflight,
      // Persist after every iteration so a crash/Ctrl+C can resume with --resume.
      onIteration: (reports) => save({ goal, currentGoal, reports }),
    },
    isAborted
  );

  // On success the work is done — drop the checkpoint so a later run starts fresh.
  if (result.status === "production_ready") clear();
  return result;
}

export { summarizeAutopilot };
