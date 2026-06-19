import { EventEmitter } from "events";
import { AIProvider, ChatMessage, ChatResponse, ToolCall, ToolDef, contentToText } from "../ai/types.js";
import { redact } from "./redact.js";
import { wrapToolError } from "./error-recovery.js";
import { formatBudgetWarning, budgetThresholds } from "./budget-gate.js";
import type { Attachment } from "./attachments.js";

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
  /** Model-driven compaction: each archival unit is summarized via the injected
   *  fn, yielding a semantic summary instead of a lossy concat. Preferred over
   *  ensureUnder for overflow recovery when a summarize fn is available. */
  compactWithSummarizer?(summarize: (unitTexts: string[]) => Promise<string>): Promise<void>;
  /** Add a multimodal user message (text + image attachments). Optional; when
   *  absent, the runner falls back to plain-text addMessage (no vision). */
  addVisionMessage?(text: string, attachments: Attachment[]): void;
}

export interface AgentRunnerDeps {
  provider: AIProvider;
  context: ContextManagerLike;
  toolDefs: ToolDef[];
  executeTool: (tc: ToolCall) => Promise<ChatMessage>;
  extractToolCalls: (content: string) => ToolCall[] | null;
  /** Optional model-driven summarizer for compaction. When present AND the
   *  context supports compactWithSummarizer, overflow recovery produces a real
   *  summary instead of a lossy concat. Injected by the caller (app.ts/cli.ts)
   *  as a single provider.chat round. */
  summarizeForCompaction?: (unitTexts: string[]) => Promise<string>;
}

export interface AgentRunnerConfig {
  model?: string;
  maxRounds: number;
  temperature?: number;
  maxTokens?: number;
  largeContextWarnAt?: number;
  /** Soft cap: proactively compact the context under this before each model call. */
  maxContextTokens?: number;
  /** v2.7: USD spend ceiling. Emits budget warnings at 50/80%, aborts at 100%. */
  budgetUSD?: number;
}

export interface AgentRunResult {
  rounds: number;
  finalContent: string;
  stopReason: "no_tool_calls" | "max_rounds" | "aborted" | "error" | "budget_exceeded";
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
  budget: (info: { spent: number; budget: number; status: string; warning: string }) => void;
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
  private readonly summarizeForCompaction?: (unitTexts: string[]) => Promise<string>;
  private readonly config: AgentRunnerConfig;

  constructor(deps: AgentRunnerDeps, config: AgentRunnerConfig) {
    super();
    this.provider = deps.provider;
    this.context = deps.context;
    this.toolDefs = deps.toolDefs;
    this.executeTool = deps.executeTool;
    this.summarizeForCompaction = deps.summarizeForCompaction;
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

  async run(userMessage: string, signal?: AbortSignal, attachments?: Attachment[]): Promise<AgentRunResult> {
    const { model, maxRounds, temperature, maxTokens } = this.config;

    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let completedRounds = 0;
    let finalContent = "";
    let stopReason: AgentRunResult["stopReason"] = "no_tool_calls";

    // Multimodal: when image attachments are present AND the context supports
    // vision, build a ContentPart[] message; otherwise plain text. Falls back
    // gracefully when the context lacks addVisionMessage (fakes, old callers).
    if (attachments && attachments.length > 0 && this.context.addVisionMessage) {
      this.context.addVisionMessage(userMessage, attachments);
    } else {
      this.context.addMessage("user", userMessage);
    }

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
            if (!signal?.aborted && compactTries < 3 && isContextOverflow(err)) {
              // Prefer the model-driven summarizer (semantic summary) when both
              // the context and an injected summarize fn are available; fall back
              // to the lossy ensureUnder otherwise. This is the v2.0 wiring that
              // connects compactWithSummarizer to the live loop.
              const canSummarize =
                this.summarizeForCompaction && this.context.compactWithSummarizer;
              if (canSummarize) {
                compactTries++;
                try {
                  await this.context.compactWithSummarizer!(this.summarizeForCompaction!);
                  this.emit("compacted", this.context.getTotalTokens());
                  continue;
                } catch {
                  // summarizer threw — fall through to ensureUnder below
                }
              }
              if (this.context.ensureUnder) {
                compactTries++;
                const target = Math.max(20000, Math.floor((softCap ?? 120000) * Math.pow(0.6, compactTries)));
                this.context.ensureUnder(target);
                this.emit("compacted", this.context.getTotalTokens());
                continue;
              }
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

        // v2.7: proactive budget gate. Warn at 50/80%, abort the run at 100%.
        if (this.config.budgetUSD && this.config.budgetUSD > 0) {
          const { estimateCostUSD } = await import("./pricing.js");
          const spent = usage.totalTokens > 0
            ? estimateCostUSD(this.config.model ?? "", usage.promptTokens, usage.completionTokens)
            : 0;
          const warning = formatBudgetWarning(spent, this.config.budgetUSD);
          if (warning) {
            this.emit("budget", { spent, budget: this.config.budgetUSD, status: budgetThresholds(spent, this.config.budgetUSD), warning });
          }
          if (budgetThresholds(spent, this.config.budgetUSD) === "exceeded") {
            this.emit("runError", new Error(`Budget exceeded: $${spent.toFixed(2)} spent (limit $${this.config.budgetUSD.toFixed(2)})`));
            return { stopReason: "budget_exceeded", rounds: round, finalContent: "", usage };
          }
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
            const rawText = redact(contentToText(resultMsg.content));
            const ok = !rawText.startsWith("ERROR");
            // On error, wrap the result with a self-reliance nudge so the model
            // researches + retries instead of stopping — the "don't get caught
            // up" behavior. The existing maxRounds loop carries the retry out.
            const resultText = ok ? rawText : wrapToolError(rawText, false);
            return {
              tc,
              text: resultText,
              ok,
              firstLine: rawText.split("\n")[0].slice(0, 200),
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
