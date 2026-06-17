/**
 * V9 deterministic pipeline engine (lite, dependency-free).
 *
 * A "pipeline" is an ordered list of named prompt steps defined in a plain JSON
 * file (NO yaml lib). Steps run in declaration order; a run of consecutive steps
 * marked `parallel: true` is executed concurrently as one group, while
 * non-parallel steps run one at a time. Each step receives the results of all
 * prior steps so its prompt can reference earlier output.
 *
 * This module is intentionally PURE: it never touches singletons or the agent.
 * The per-step executor (`runStep`) is injected, which keeps the engine fully
 * unit-testable without a live provider/agent.
 */

export interface PipelineStep {
  name: string;
  prompt: string;
  /** When true, this step joins a concurrent group with adjacent parallel steps. */
  parallel?: boolean;
}

export interface Pipeline {
  name: string;
  steps: PipelineStep[];
}

export interface PipelineStepResult {
  name: string;
  result: string;
}

export interface RunPipelineOptions {
  /** Optional hook fired right before a step (or parallel group) is dispatched. */
  onStepStart?: (step: PipelineStep) => void;
  /** Optional hook fired after a step settles (success or recorded error). */
  onStepEnd?: (result: PipelineStepResult) => void;
}

/** A function that executes a single step given all prior results. Injected. */
export type RunStepFn = (
  step: PipelineStep,
  priorResults: PipelineStepResult[]
) => Promise<string>;

/**
 * Parse + validate a pipeline from a JSON string. Throws clear, actionable
 * errors so a bad pipeline file fails loudly rather than silently misbehaving.
 */
export function parsePipeline(json: string): Pipeline {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `Pipeline is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Pipeline must be a JSON object with 'name' and 'steps'.");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    throw new Error("Pipeline 'name' is required and must be a non-empty string.");
  }

  if (!Array.isArray(obj.steps)) {
    throw new Error("Pipeline 'steps' is required and must be an array.");
  }
  if (obj.steps.length === 0) {
    throw new Error("Pipeline 'steps' must contain at least one step.");
  }

  const steps: PipelineStep[] = obj.steps.map((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`Step ${i} must be an object with 'name' and 'prompt'.`);
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.name !== "string" || s.name.trim() === "") {
      throw new Error(`Step ${i} 'name' is required and must be a non-empty string.`);
    }
    if (typeof s.prompt !== "string" || s.prompt.trim() === "") {
      throw new Error(`Step "${s.name}" 'prompt' is required and must be a non-empty string.`);
    }
    if (s.parallel !== undefined && typeof s.parallel !== "boolean") {
      throw new Error(`Step "${s.name}" 'parallel' must be a boolean when present.`);
    }
    const step: PipelineStep = { name: s.name, prompt: s.prompt };
    if (s.parallel === true) step.parallel = true;
    return step;
  });

  return { name: obj.name, steps };
}

/**
 * Run a pipeline with an injected per-step executor.
 *
 * Execution model:
 *  - Steps are walked in order.
 *  - A maximal run of consecutive `parallel: true` steps forms a group that runs
 *    concurrently via Promise.all. Each step in the group sees the SAME snapshot
 *    of prior results (results produced before the group started).
 *  - A non-parallel step runs alone and sees all results accumulated so far.
 *  - A per-step failure is caught and recorded as `result: "ERROR: ..."`; the
 *    pipeline continues with the remaining steps.
 *
 * Returns one result per step, in declaration order.
 */
export async function runPipeline(
  pipeline: Pipeline,
  runStep: RunStepFn,
  opts: RunPipelineOptions = {}
): Promise<PipelineStepResult[]> {
  const results: PipelineStepResult[] = [];

  const runOne = async (
    step: PipelineStep,
    prior: PipelineStepResult[]
  ): Promise<PipelineStepResult> => {
    opts.onStepStart?.(step);
    let res: PipelineStepResult;
    try {
      const out = await runStep(step, prior);
      res = { name: step.name, result: out };
    } catch (err) {
      res = {
        name: step.name,
        result: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    opts.onStepEnd?.(res);
    return res;
  };

  let i = 0;
  while (i < pipeline.steps.length) {
    const step = pipeline.steps[i];

    if (step.parallel) {
      // Collect the maximal consecutive parallel group starting at i.
      const group: PipelineStep[] = [];
      while (i < pipeline.steps.length && pipeline.steps[i].parallel) {
        group.push(pipeline.steps[i]);
        i++;
      }
      // Snapshot prior results so all group members see the same input.
      const snapshot = results.slice();
      const groupResults = await Promise.all(group.map((s) => runOne(s, snapshot)));
      results.push(...groupResults);
    } else {
      const res = await runOne(step, results.slice());
      results.push(res);
      i++;
    }
  }

  return results;
}
