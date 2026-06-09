import { EventEmitter } from "events";
import { AIProvider, ChatMessage, ToolCall, ToolDef, contentToText } from "../ai/types.js";

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
}

export interface AgentRunnerConfig {
  model?: string;
  maxRounds: number;
  temperature?: number;
  maxTokens?: number;
  largeContextWarnAt?: number;
}

export interface AgentRunResult {
  rounds: number;
  finalContent: string;
  stopReason: "no_tool_calls" | "max_rounds" | "aborted" | "error";
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

  constructor(deps: AgentRunnerDeps, config: AgentRunnerConfig) {
    super();
    this.provider = deps.provider;
    this.context = deps.context;
    this.toolDefs = deps.toolDefs;
    this.executeTool = deps.executeTool;
    this.extract = deps.extractToolCalls;
    this.config = config;
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

        this.emit("roundStart", round);
        completedRounds = round;

        const aiMessages = this.context.toAIMessages();

        const response = await this.provider.chatStream(
          aiMessages,
          { model, tools: this.toolDefs, temperature, maxTokens, signal },
          (chunk) => {
            if (chunk.content) this.emit("token", chunk.content);
          }
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

        // GUARD: add the assistant message when there is content OR tool calls.
        // Empty content + tool calls is normal (OpenAI/Anthropic) — never skip.
        if (response.content || (toolCalls && toolCalls.length)) {
          this.context.addMessage("assistant", response.content || "", { toolCalls });
        }

        const willContinue = !!(toolCalls && toolCalls.length && !signal?.aborted);

        if (!willContinue) {
          stopReason = signal?.aborted ? "aborted" : "no_tool_calls";
          this.emit("roundEnd", round, false);
          break;
        }

        // Run the tool loop, THEN emit roundEnd after it.
        for (const tc of toolCalls!) {
          if (signal?.aborted) {
            stopReason = "aborted";
            break;
          }

          this.emit("toolStart", tc.name, tc.arguments);
          const resultMsg = await this.executeTool(tc);
          const resultText = contentToText(resultMsg.content);
          const ok = !resultText.startsWith("ERROR");
          const firstLine = resultText.split("\n")[0].slice(0, 200);
          this.emit("toolResult", tc.name, ok, firstLine, resultText);
          this.context.addMessage("tool", `[Tool: ${resultMsg.name}]\n${resultText}`, {
            toolCallId: tc.id,
            name: tc.name,
          });
        }

        this.emit("roundEnd", round, !signal?.aborted);

        if (signal?.aborted) {
          stopReason = "aborted";
          break;
        }

        // If we just used the final allowed round and still want to continue,
        // we'll exit the loop on the next iteration check — mark max_rounds.
        if (round === maxRounds) {
          stopReason = "max_rounds";
        }
      }

      const warnAt = this.config.largeContextWarnAt;
      if (typeof warnAt === "number" && this.context.getMessageCount() > warnAt) {
        this.emit("contextLarge", this.context.getMessageCount());
      }
    } catch (err) {
      // Aborting the in-flight stream makes fetch throw — that's a user cancel,
      // not a failure, so surface it as "aborted" with no scary error message.
      if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        stopReason = "aborted";
      } else {
        stopReason = "error";
        this.emit("runError", err);
      }
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
}
