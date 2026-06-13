import { EventEmitter } from "events";
import { AIProvider, ChatMessage, ChatOptions, ChatResponse, ToolCall, ToolDef, contentToText } from "../ai/types.js";
import { evaluateRound, EvalResult } from "./self-evaluator.js";
import { StuckDetector } from "./stuck-detector.js";
import { BudgetEnforcer } from "./budget-enforcer.js";

/**
 * Minimal interface the runner needs from a context manager. The real
 * ContextManager (src/ai/context.ts) satisfies this, but tests can supply a
 * lightweight array-backed fake.
 */
export interface ContextManagerLike {
  setSystemPrompt(p: string): void;
  toAIMessages(): ChatMessage[];
  addMessage(
    role: "user" | "assistant" | "tool",
    content: string,
    metadata?: Record<string, unknown>
  ): void;
  getMessageCount(): number;
  getTotalTokens(): number;
}

export interface AgentRunnerDeps {
  provider: AIProvider;
  context: ContextManagerLike;
  toolDefs: ToolDef[];
  executeTool: (tc: ToolCall) => Promise<ChatMessage>;
  extractToolCalls: (content: string) => ToolCall[] | null;
  /**
   * Optional verification (typically a type-check/build). When `verifyOnComplete`
   * is set and the agent made edits, this runs as the agent is about to finish;
   * `ok:false` feeds `output` back so the agent fixes the problems before stopping.
   */
  runVerification?: () => Promise<{ ok: boolean; output: string }>;
  /**
   * Optional context compaction, called at the start of each round. The host
   * decides whether compaction is needed (e.g. utilization > threshold) and
   * performs it (typically LLM summarization). Returns true if it compacted.
   */
  compactContext?: () => Promise<boolean>;
}

export interface AgentRunnerConfig {
  model?: string;
  maxRounds: number;
  temperature?: number;
  maxTokens?: number;
  largeContextWarnAt?: number;
  selfEvaluation?: boolean;
  /** Run self-evaluation only every N rounds (default 3). Each eval is a full
   *  extra model call, so evaluating every round triples model spend on long
   *  tasks for little gain — the loop already exits on no_tool_calls and stuck
   *  is detected separately. */
  selfEvalInterval?: number;
  completionDetection?: boolean;
  stuckDetection?: boolean;
  stuckThreshold?: number;
  budgetUSD?: number;
  getEstimatedCost?: () => number;
  /** Run verification (e.g. tsc) when the agent finishes after making edits. */
  verifyOnComplete?: boolean;
  /** Max verify→fix cycles before giving up and stopping anyway (default 2). */
  maxVerifyRetries?: number;
  /** Attempts for a model call before failing the run, on transient errors
   *  (rate limit / 5xx / network). Default 3. Set 1 to disable retries. */
  maxRetries?: number;
  /** Base backoff in ms between model-call retries (exponential). Default 500. */
  retryBaseDelayMs?: number;
}

export interface AgentRunResult {
  rounds: number;
  finalContent: string;
  stopReason: "no_tool_calls" | "max_rounds" | "aborted" | "error" | "task_complete" | "stuck" | "budget_exceeded";
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Typed event map for the runner. Note: deliberately NO "error" event — Node's
 * EventEmitter treats "error" specially (emitting with no listener throws). We
 * use "runError" instead.
 */
export interface AgentRunnerEvents {
  roundStart: (round: number) => void;
  token: (text: string) => void;
  streamEnd: (round: number) => void;
  usage: (u: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  toolStart: (name: string, args: string) => void;
  toolResult: (name: string, ok: boolean, firstLine: string, full: string) => void;
  roundEnd: (round: number, willContinue: boolean) => void;
  contextLarge: (count: number) => void;
  runError: (err: unknown) => void;
  done: (result: AgentRunResult) => void;
  selfEvaluation: (assessment: string) => void;
  taskComplete: (reason: string) => void;
  budgetExceeded: (cost: number, budget: number) => void;
  stuckDetected: (toolName: string, count: number) => void;
  verifyFailed: (output: string) => void;
  verifyPassed: () => void;
  retry: (attempt: number, delayMs: number, err: unknown) => void;
  compacted: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether a model-call error is worth retrying (rate limit / 5xx / network). */
function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    /\b(429|500|502|503|504)\b/.test(msg) ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("network error")
  );
}

/** Tools that change files on disk — used to decide whether to verify on completion. */
function isMutatingTool(name: string, argsStr: string): boolean {
  if (name === "patch") return true;
  if (name === "file") {
    try {
      const action = String((JSON.parse(argsStr) as { action?: unknown }).action ?? "");
      return action === "write" || action === "edit" || action === "delete" || action === "mkdir";
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * UI-agnostic agentic loop. Streams assistant responses, dispatches tool calls,
 * and feeds tool results back into the conversation until the model stops
 * calling tools, the round budget is exhausted, or the run is aborted.
 */
export class AgentRunner extends EventEmitter {
  private readonly provider: AIProvider;
  private readonly context: ContextManagerLike;
  private readonly toolDefs: ToolDef[];
  private readonly executeTool: (tc: ToolCall) => Promise<ChatMessage>;
  private readonly extract: (content: string) => ToolCall[] | null;
  private readonly config: AgentRunnerConfig;
  private readonly stuckDetector: StuckDetector;
  private readonly budgetEnforcer: BudgetEnforcer | null;
  private readonly runVerification?: () => Promise<{ ok: boolean; output: string }>;
  private readonly compactContext?: () => Promise<boolean>;
  private consecutiveStuckCount = 0;
  private edited = false;
  private verifyCount = 0;

  constructor(deps: AgentRunnerDeps, config: AgentRunnerConfig) {
    super();
    this.provider = deps.provider;
    this.context = deps.context;
    this.toolDefs = deps.toolDefs;
    this.executeTool = deps.executeTool;
    this.extract = deps.extractToolCalls;
    this.runVerification = deps.runVerification;
    this.compactContext = deps.compactContext;
    this.config = config;
    this.stuckDetector = new StuckDetector(config.stuckThreshold ?? 3);
    this.budgetEnforcer = config.budgetUSD
      ? new BudgetEnforcer(config.budgetUSD, config.getEstimatedCost ?? (() => 0))
      : null;
  }

  /**
   * Stream a model response, retrying transient failures (rate limit / 5xx /
   * network) with exponential backoff. Retries only happen before any token is
   * streamed, so output is never duplicated.
   */
  private async streamWithRetry(
    messages: ChatMessage[],
    options: ChatOptions,
    signal?: AbortSignal
  ): Promise<ChatResponse> {
    const maxAttempts = Math.max(1, this.config.maxRetries ?? 3);
    const baseDelay = this.config.retryBaseDelayMs ?? 500;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) throw new Error("aborted");
      let streamedAny = false;
      try {
        return await this.provider.chatStream(messages, options, (chunk) => {
          if (chunk.content) {
            streamedAny = true;
            this.emit("token", chunk.content);
          }
        });
      } catch (err) {
        lastErr = err;
        if (streamedAny || signal?.aborted || attempt === maxAttempts || !isTransientError(err)) {
          throw err;
        }
        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.emit("retry", attempt, delay, err);
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  /**
   * Verify-on-complete gate. Returns true when it injected a fix-it message
   * (the caller should keep looping); false when the agent may stop. Bounded by
   * maxVerifyRetries so a stubborn error can't loop forever.
   */
  private async verifyGate(): Promise<boolean> {
    if (!this.runVerification || !this.config.verifyOnComplete) return false;
    if (!this.edited) return false;
    if (this.verifyCount >= (this.config.maxVerifyRetries ?? 2)) return false;
    this.verifyCount++;

    let result: { ok: boolean; output: string };
    try {
      result = await this.runVerification();
    } catch {
      // If verification itself can't run, don't block the agent from finishing.
      return false;
    }

    if (result.ok) {
      this.emit("verifyPassed");
      return false;
    }

    this.emit("verifyFailed", result.output);
    this.context.addMessage(
      "user",
      "Automated verification (type-check/build) found problems after your changes:\n\n" +
        result.output +
        "\n\nFix these problems. If a problem is pre-existing and unrelated to your task, " +
        "say so explicitly and then you may stop."
    );
    this.edited = false; // require fresh edits before verifying again
    return true;
  }

  // ---- typed event overloads -------------------------------------------------

  on<E extends keyof AgentRunnerEvents>(event: E, listener: AgentRunnerEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  emit<E extends keyof AgentRunnerEvents>(
    event: E,
    ...args: Parameters<AgentRunnerEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }

  async run(userMessage: string, signal?: AbortSignal): Promise<AgentRunResult> {
    const { model, maxRounds, temperature, maxTokens } = this.config;

    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let completedRounds = 0;
    let finalContent = "";
    let stopReason: AgentRunResult["stopReason"] = "no_tool_calls";

    this.context.addMessage("user", userMessage);

    try {
      for (let round = 1; round <= maxRounds; round++) {
        if (signal?.aborted) {
          stopReason = "aborted";
          break;
        }

        if (this.budgetEnforcer?.isExceeded()) {
          stopReason = "budget_exceeded";
          this.emit("budgetExceeded", this.config.getEstimatedCost?.() ?? 0, this.config.budgetUSD!);
          break;
        }

        this.emit("roundStart", round);
        completedRounds = round;

        // Compact the conversation (LLM summarization) before sending, if the
        // host says it's needed — keeps long runs under the context limit
        // without the lossy char-slice fallback.
        if (this.compactContext) {
          try {
            if (await this.compactContext()) this.emit("compacted");
          } catch {
            // Compaction is best-effort; never block the round on it.
          }
        }

        const aiMessages = this.context.toAIMessages();

        const response = await this.streamWithRetry(
          aiMessages,
          { model, tools: this.toolDefs, temperature, maxTokens },
          signal
        );

        this.emit("streamEnd", round);

        finalContent = response.content || finalContent;

        if (response.usage) {
          usage.promptTokens += response.usage.promptTokens;
          usage.completionTokens += response.usage.completionTokens;
          usage.totalTokens += response.usage.totalTokens;
          this.emit("usage", response.usage);
        }

        const toolCalls =
          response.toolCalls && response.toolCalls.length
            ? response.toolCalls
            : this.extract(response.content);

        if (response.content || (toolCalls && toolCalls.length)) {
          this.context.addMessage("assistant", response.content || "", { toolCalls });
        }

        const willContinue = !!(toolCalls && toolCalls.length && !signal?.aborted);

        if (!willContinue) {
          // Before declaring done: if the agent edited files, verify they
          // compile and feed any problems back so it self-corrects.
          if (!signal?.aborted && (await this.verifyGate())) {
            this.emit("roundEnd", round, true);
            continue;
          }
          stopReason = signal?.aborted ? "aborted" : "no_tool_calls";
          this.emit("roundEnd", round, false);
          break;
        }

        // Batch tool calls with concurrency cap and same-file serialization
        const MAX_CONCURRENT = 4;
        const batches: ToolCall[][] = [];
        let currentBatch: ToolCall[] = [];
        const writtenPaths = new Set<string>();

        for (const tc of toolCalls!) {
          const args = (() => { try { return JSON.parse(tc.arguments); } catch { return {}; } })();
          const path = String(args.path || args.file || args.destination || "");
          const conflicts = path && writtenPaths.has(path);
          if (conflicts || currentBatch.length >= MAX_CONCURRENT) {
            if (currentBatch.length) batches.push(currentBatch);
            currentBatch = [tc];
            writtenPaths.clear();
            if (path) writtenPaths.add(path);
          } else {
            currentBatch.push(tc);
            if (path) writtenPaths.add(path);
          }
        }
        if (currentBatch.length) batches.push(currentBatch);

        for (const batch of batches) {
          if (signal?.aborted) { stopReason = "aborted"; break; }

          const settled = await Promise.allSettled(batch.map((tc) => this.executeSingleTool(tc, signal)));

          for (let ri = 0; ri < settled.length; ri++) {
            const r = settled[ri];
            const tc = batch[ri];

            if (this.config.stuckDetection) {
              this.stuckDetector.record(tc);
            }

            if (r.status === "rejected") {
              this.emit("toolResult", tc.name, false, String(r.reason), String(r.reason));
              this.context.addMessage("tool", `[Tool: ${tc.name}]\nERROR: ${r.reason}`, { toolCallId: tc.id, name: tc.name });
            } else {
              const { name, ok, firstLine, resultText } = r.value;
              this.emit("toolResult", name, ok, firstLine, resultText);
              this.context.addMessage("tool", `[Tool: ${name}]\n${resultText}`, { toolCallId: tc.id, name });
              if (ok && isMutatingTool(name, tc.arguments)) this.edited = true;
            }
          }
        }

        this.emit("roundEnd", round, !signal?.aborted);

        if (signal?.aborted) {
          stopReason = "aborted";
          break;
        }

        // Stuck detection
        if (this.config.stuckDetection && this.stuckDetector.isStuck()) {
          this.consecutiveStuckCount++;
          const stuckToolName = toolCalls![0]?.name || "unknown";
          this.emit("stuckDetected", stuckToolName, this.config.stuckThreshold ?? 3);

          if (this.consecutiveStuckCount >= 2) {
            stopReason = "stuck";
            break;
          }

          // Inject recovery hint and let the model try once more
          this.context.addMessage("user",
            "You appear stuck repeating the same operation. " +
            "Try a completely different approach. If the task cannot progress further, " +
            "respond with TASK_COMPLETE or TASK_STUCK."
          );
          this.stuckDetector.reset();
          continue;
        }

        this.consecutiveStuckCount = 0;

        // Self-evaluation — gated to every Nth round to avoid a full extra
        // model call on every tool-using round (see selfEvalInterval).
        const evalInterval = Math.max(1, this.config.selfEvalInterval ?? 3);
        if (this.config.selfEvaluation && round % evalInterval === 0) {
          const evalOutcome = await evaluateRound(
            this.context.toAIMessages(),
            this.provider,
            model
          );

          if (evalOutcome.usage) {
            usage.promptTokens += evalOutcome.usage.promptTokens;
            usage.completionTokens += evalOutcome.usage.completionTokens;
            usage.totalTokens += evalOutcome.usage.totalTokens;
            this.emit("usage", evalOutcome.usage);
          }

          this.emit("selfEvaluation", evalOutcome.assessment);

          if (evalOutcome.result === "complete") {
            stopReason = "task_complete";
            this.emit("taskComplete", "self_evaluation");
            break;
          }
          if (evalOutcome.result === "stuck") {
            stopReason = "stuck";
            this.emit("taskComplete", "stuck_detected");
            break;
          }
        }

        if (round === maxRounds) {
          stopReason = "max_rounds";
        }
      }

      const warnAt = this.config.largeContextWarnAt;
      if (typeof warnAt === "number" && this.context.getMessageCount() > warnAt) {
        this.emit("contextLarge", this.context.getMessageCount());
      }
    } catch (err) {
      stopReason = "error";
      this.emit("runError", err);
    }

    const result: AgentRunResult = {
      rounds: completedRounds,
      finalContent,
      stopReason,
      usage,
    };
    this.emit("done", result);
    return result;
  }

  /** Execute a single tool call, returning structured result for batch processing. */
  private async executeSingleTool(tc: ToolCall, signal?: AbortSignal): Promise<{ name: string; ok: boolean; firstLine: string; resultText: string }> {
    if (signal?.aborted) throw new Error("aborted");
    this.emit("toolStart", tc.name, tc.arguments);
    const resultMsg = await this.executeTool(tc);
    const resultText = contentToText(resultMsg.content);
    const ok = !resultText.startsWith("ERROR");
    const firstLine = resultText.split("\n")[0].slice(0, 200);
    return { name: tc.name, ok, firstLine, resultText };
  }
}
