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
import { runAutopilot, summarizeAutopilot, type IterationReport, type AutopilotResult } from "./autopilot.js";
import { runGsd, buildPhasePrompt } from "./gsd.js";
import { resolveVerifyCommands, runVerifyCommands, workingTreeHash, type VerifyResult } from "./verify.js";

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
  /** Test seams (default to the real implementations). */
  verify?: (commands: string[]) => Promise<VerifyResult>;
  treeHash?: () => Promise<string | null>;
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

  log(
    `Autopilot: grinding toward production-ready (up to ${maxIterations} iterations; ` +
      `gate: ${commands.length ? commands.join(" && ") : "model-only"}).`
  );

  let currentGoal = goal;

  return runAutopilot(
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

      return { iteration, summary, checksPassed: v.passed, productionReady: reallyReady, remaining, changed };
    },
    { maxIterations, maxStalls },
    isAborted
  );
}

export { summarizeAutopilot };
