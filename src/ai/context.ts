import { ChatMessage as AIChatMessage, ToolCall } from "../ai/types.js";
import { createLogger } from "../utils/logger.js";
import { planCompaction, unitToText, planIsSafe } from "./compact-strategy.js";

const log = createLogger({ prefix: "context" });

export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  tokenEstimate?: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class ContextManager {
  private sessionId: string;
  private systemPrompt: string = "";
  private messages: ConversationMessage[] = [];
  private maxMessages: number = 100;
  private maxTokens: number = 120000;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  addMessage(role: "user" | "assistant" | "tool", content: string, metadata?: Record<string, unknown>): void {
    const tokenEstimate = estimateTokens(content);
    this.messages.push({
      role,
      content,
      timestamp: Date.now(),
      metadata,
      tokenEstimate,
    });

    if (this.getTotalTokens() > this.maxTokens) {
      this.autoCompact();
    }

    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  /**
   * Keep only the first `count` messages (drop everything from index `count`
   * onward). Used by message edit/regenerate: the GUI truncates its block list
   * to an edit point, then re-sends, and we mirror that here so the model never
   * sees the discarded turns. Returns the number of messages dropped.
   */
  truncateToCount(count: number): number {
    const clamped = Math.max(0, Math.floor(count));
    if (clamped >= this.messages.length) return 0;
    const dropped = this.messages.length - clamped;
    this.messages = this.messages.slice(0, clamped);
    log.debug(`truncated context (kept ${clamped}, dropped ${dropped})`);
    return dropped;
  }

  toAIMessages(): AIChatMessage[] {
    const messages: AIChatMessage[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    for (const msg of this.messages) {
      // Defensive: never emit a second `system` message into the model input.
      // The real system prompt is pushed above; anything else with role
      // "system" (e.g. a legacy compaction summary) is demoted to "user" so it
      // can't overwrite the system prompt on Anthropic (last-system-wins).
      const role = msg.role === "system" ? "user" : msg.role;
      const out: AIChatMessage = { role, content: msg.content };
      const md = msg.metadata;
      if (md) {
        if (md.toolCalls) out.toolCalls = md.toolCalls as ToolCall[];
        if (md.toolCallId) out.toolCallId = md.toolCallId as string;
        if (md.name) out.name = md.name as string;
      }
      messages.push(out);
    }
    return messages;
  }

  clear(): void {
    this.messages = [];
    this.systemPrompt = "";
  }

  /**
   * Compact the context using the shared strategy (compact-strategy.ts): keep
   * the system prompt + recent turns verbatim; summarize the cohesive middle.
   *
   * This synchronous form summarizes by concatenating each archival unit's text
   * (role-tagged) — a lossy-but-offline fallback that preserves the pair-split
   * invariants. For a real model-generated summary, use `compactWithSummarizer`.
   */
  compact(): void {
    // buildSummary receives the already-flattened unit texts (see applyPlan).
    this.applyPlan(planCompaction(this.messages, 6), (unitTexts) =>
      unitTexts.join("\n\n---\n\n")
    );
  }

  /**
   * Compact with a model-driven summarizer. Each cohesive archival unit is
   * passed to `summarize(unitTexts) -> summary`; the result replaces the units.
   * Async because the summarizer is a model call. Falls back to compact() if no
   * summarizer is supplied or the call rejects.
   */
  async compactWithSummarizer(
    summarize: (unitTexts: string[]) => Promise<string>
  ): Promise<void> {
    const plan = planCompaction(this.messages, 6);
    if (plan.summarizeUnits.length === 0) return;
    try {
      const unitTexts = plan.summarizeUnits.map((u) => unitToText(u));
      const summary = await summarize(unitTexts);
      this.applyPlan(plan, () => summary);
    } catch (err) {
      log.warn(`summarizer failed, falling back to concat: ${err instanceof Error ? err.message : String(err)}`);
      this.compact();
    }
  }

  /**
   * Apply a compaction plan: keep the planned messages verbatim, replace the
   * summarized units with a single "earlier conversation" user-note carrying
   * `buildSummary(unitTexts)`. Asserts the plan is safe (never splits a pair).
   */
  private applyPlan(
    plan: ReturnType<typeof planCompaction>,
    buildSummary: (unitTexts: string[]) => string
  ): void {
    if (this.messages.length <= 6 && plan.summarizeUnits.length === 0) return;
    if (!planIsSafe(this.messages, plan)) {
      log.warn("compaction plan would split an assistant→tool pair; skipping");
      return;
    }
    const kept = plan.keepIndices.map((i) => this.messages[i]);
    if (plan.summarizeUnits.length === 0) {
      // Nothing to summarize (short conversation); keep as-is.
      return;
    }
    const unitTexts = plan.summarizeUnits.map((u) => unitToText(u));
    const summaryText = buildSummary(unitTexts);
    const compactedCount = plan.summarizeUnits.reduce((n, u) => n + u.messages.length, 0);
    // Keep the summary as a "user" note, NOT a system message — a system-role
    // entry here would overwrite the real system prompt on Anthropic.
    const summaryMessage: ConversationMessage = {
      role: "user",
      content: `[Earlier conversation summary — ${compactedCount} messages compacted]\n${summaryText}`,
      timestamp: Date.now(),
      tokenEstimate: estimateTokens(summaryText),
    };
    this.messages = [summaryMessage, ...kept];
    log.info(`Context compacted: ${compactedCount + kept.length} -> ${this.messages.length} messages`);
  }

  private autoCompact(): void {
    log.info(`Auto-compacting context (tokens: ${this.getTotalTokens()})`);
    this.compact();
  }

  /**
   * Force the conversation under `maxTokens` no matter what: compact, then
   * hard-trim the oldest messages, then truncate remaining content as a last
   * resort. This GUARANTEES the prompt can always shrink, so the agent recovers
   * from an over-long context instead of wedging (no app restart needed).
   * Returns the resulting token total.
   */
  ensureUnder(maxTokens: number): number {
    const limit = Math.max(2000, maxTokens);
    if (this.getTotalTokens() <= limit) return this.getTotalTokens();
    this.compact();
    // Drop the oldest messages (keep the last 2) until we fit.
    while (this.getTotalTokens() > limit && this.messages.length > 2) {
      this.messages.shift();
    }
    // Last resort: truncate each remaining message to a fair share of the budget.
    if (this.getTotalTokens() > limit && this.messages.length > 0) {
      const perMsgChars = Math.max(400, Math.floor((limit / this.messages.length) * 3.5));
      for (const m of this.messages) {
        if (m.content.length > perMsgChars) {
          m.content = m.content.slice(0, perMsgChars) + "\n…[trimmed to fit context]";
          m.tokenEstimate = estimateTokens(m.content);
        }
      }
    }
    log.info(`Context forced under ${limit} tokens → ${this.getTotalTokens()}`);
    return this.getTotalTokens();
  }

  getTotalTokens(): number {
    return this.messages.reduce((sum, m) => sum + (m.tokenEstimate || estimateTokens(m.content)), 0);
  }

  /** Sum of raw content character counts (for /context display). */
  getCharTotal(): number {
    return this.messages.reduce((sum, m) => sum + m.content.length, 0);
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  getLastMessage(): ConversationMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  getContextUtilization(): number {
    return Math.min(1, this.getTotalTokens() / this.maxTokens);
  }
}

const defaultContextManager = new ContextManager("default");

export const contextManager = defaultContextManager;
