import { AgentRunner, AgentRunnerDeps, AgentRunResult, ContextManagerLike } from "./agent-runner.js";
import { ChatMessage, ToolCall, ToolDef } from "../ai/types.js";
import { PermissionEngine, toPermissionRequest } from "./permissions.js";

// ---- Public types ----------------------------------------------------------

export interface PlanModeConfig {
  maxResearchRounds: number;
  maxExecutionRounds: number;
}

export type PlanModeResult = {
  plan: string;
  rounds: number;
  approved: boolean;
  stopReason: string;
};

// ---- Callbacks -----------------------------------------------------------

export interface PlanModeCallbacks {
  onPlanStart: () => void;
  onPlanReady: (plan: string) => Promise<boolean>;
  onExecutionStart: () => void;
}

// ---- PlanMode ------------------------------------------------------------

export class PlanMode {
  private readonly deps: AgentRunnerDeps;
  private readonly callbacks: PlanModeCallbacks;
  private readonly config: PlanModeConfig;

  constructor(
    deps: AgentRunnerDeps,
    callbacks: PlanModeCallbacks,
    config?: Partial<PlanModeConfig>
  ) {
    this.deps = deps;
    this.callbacks = callbacks;
    this.config = {
      maxResearchRounds: config?.maxResearchRounds ?? 5,
      maxExecutionRounds: config?.maxExecutionRounds ?? 30,
    };
  }

  async run(task: string, signal?: AbortSignal): Promise<PlanModeResult> {
    this.callbacks.onPlanStart();

    // -- Phase 1: Research (read-only) --------------------------------------

    const planEngine = new PermissionEngine("plan", {}, process.cwd());
    const researchDeps: AgentRunnerDeps = {
      ...this.deps,
      executeTool: async (tc: ToolCall): Promise<ChatMessage> => {
        const args = JSON.parse(tc.arguments || "{}");
        const req = toPermissionRequest(tc.name, args);
        const verdict = planEngine.evaluate(req);

        if (verdict.decision === "deny") {
          return {
            role: "tool",
            content: `PLAN MODE: ${verdict.reason}`,
            toolCallId: tc.id,
            name: tc.name,
          };
        }
        return this.deps.executeTool(tc);
      },
    };

    const researcher = new AgentRunner(researchDeps, {
      maxRounds: this.config.maxResearchRounds,
    });

    let researchResult = await researcher.run(
      `Research this task in read-only mode. Gather information but do NOT make any changes.\n\nTask: ${task}`,
      signal
    );

    let plan = researchResult.finalContent;

    // -- Phase 2: Plan generation + approval gate ---------------------------

    let approved = await this.callbacks.onPlanReady(plan);

    while (!approved && !signal?.aborted) {
      const reviseResult = await researcher.run(
        `Revise the plan based on this feedback: <previous plan was rejected>\n${plan}`,
        signal
      );
      plan = reviseResult.finalContent;
      researchResult = reviseResult;
      approved = await this.callbacks.onPlanReady(plan);
    }

    if (!approved) {
      return {
        plan,
        rounds: researchResult.rounds,
        approved: false,
        stopReason: signal?.aborted ? "aborted" : "rejected",
      };
    }

    // -- Phase 3: Execution -------------------------------------------------

    this.callbacks.onExecutionStart();

    const executor = new AgentRunner(this.deps, {
      maxRounds: this.config.maxExecutionRounds,
    });

    const execResult = await executor.run(
      `Execute this approved plan:\n\n${plan}`,
      signal
    );

    return {
      plan,
      rounds: researchResult.rounds + execResult.rounds,
      approved: true,
      stopReason: execResult.stopReason,
    };
  }
}
