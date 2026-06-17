import { EventEmitter } from "events";
import { AIProvider, ChatMessage, ChatResponse, ToolCall, ToolDef, contentToText } from "../ai/types.js";
import { redact } from "./redact.js";

/** Heuristic: did the provider reject the request for being too long for the model's context? */
function isContextOverflow(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | undefined;
  const msg = (e?.message || String(err)).toLowerCase();
  if (/context length|context window|too long|maximum context|prompt is too long|too many tokens|reduce the length|exceeds the (model|maximum)/.test(msg)) return true;
  return (e?.status === 400 || e?.status === 413) && /token|context/.test(msg);
}

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
  /** Force the context under a token budget (compact + trim). Optional so simple
   *  array-backed fakes can omit it; when present it enables overflow recovery. */
  ensureUnder?(maxTokens: number): number;
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
  /** Soft cap: proactively compact the context under this before each model call. */
  maxContextTokens?: number;
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
  compacted: (totalTokens: number) => void;
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

        // Proactively keep the prompt under the soft cap so it rarely overflows.
        const softCap = this.config.maxContextTokens;
        if (softCap && this.context.ensureUnder && this.context.getTotalTokens() > softCap) {
          this.context.ensureUnder(softCap);
          this.emit("compacted", this.context.getTotalTokens());
        }

        // Reactive recovery: if the provider rejects the prompt as too long,
        // shrink the context and retry instead of failing the turn. This is what
        // lets the app run forever without a restart.
        let response: ChatResponse;
        let compactTries = 0;
        for (;;) {
          try {
            response = await this.provider.chatStream(
              this.context.toAIMessages(),
              { model, tools: this.toolDefs, temperature, maxTokens, signal },
              (chunk) => {
                if (chunk.content) this.emit("token", chunk.content);
              }
            );
            break;
          } catch (err) {
            if (!signal?.aborted && this.context.ensureUnder && compactTries < 3 && isContextOverflow(err)) {
              compactTries++;
              const target = Math.max(20000, Math.floor((softCap ?? 120000) * Math.pow(0.6, compactTries)));
              this.context.ensureUnder(target);
              this.emit("compacted", this.context.getTotalTokens());
              continue;
            }
            throw err;
          }
        }

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

        // Run the round's tool calls in parallel (independent calls — e.g. the
        // model fanning out several subagent/search/bash calls — execute
        // concurrently for throughput). Results are collected position-indexed
        // and then emitted/appended IN CALL ORDER so: (a) toolResult UI events
        // stay deterministic, and (b) tool messages follow the same order as the
        // assistant's tool_calls (OpenAI requires a result per call, in order).
        // A single shared AbortSignal is checked before each call starts.
        const calls = toolCalls!;
        // Announce every call up front so the UI shows the full fan-out.
        for (const tc of calls) this.emit("toolStart", tc.name, tc.arguments);

        const processed = await Promise.all(
          calls.map(async (tc): Promise<{
            tc: ToolCall;
            text: string;
            ok: boolean;
            firstLine: string;
            aborted: boolean;
          } | null> => {
            if (signal?.aborted) {
              return { tc, text: "", ok: false, firstLine: "", aborted: true };
            }
            const resultMsg = await this.executeTool(tc);
            // Scrub secrets from untrusted tool output at the trust boundary:
            // this single redaction covers the UI event, the message added to
            // context (hence anything sent to a model provider), and anything
            // the session manager persists to disk. A `bash`/`file` result that
            // echoes AWS_KEY=AKIA... or a bearer token is masked before it can
            // leave the process or be written to a transcript.
            const resultText = redact(contentToText(resultMsg.content));
            return {
              tc,
              text: resultText,
              ok: !resultText.startsWith("ERROR"),
              firstLine: resultText.split("\n")[0].slice(0, 200),
              aborted: false,
            };
          })
        );

        // Emit + append in original call order, not completion order.
        for (const r of processed) {
          if (!r) continue;
          if (r.aborted) {
            stopReason = "aborted";
            continue;
          }
          this.emit("toolResult", r.tc.name, r.ok, r.firstLine, r.text);
          this.context.addMessage("tool", `[Tool: ${r.tc.name}]\n${r.text}`, {
            toolCallId: r.tc.id,
            name: r.tc.name,
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
