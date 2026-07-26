import { ChatMessage as AIChatMessage, ToolCall } from "../ai/types.js";
import { createLogger } from "../utils/logger.js";

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
  /** Fired whenever a compaction actually reduces the context (auto or manual). */
  private compactListeners: Array<(method: "heuristic" | "llm") => void> = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /** Subscribe to compaction events. Returns an unsubscribe function. */
  onCompact(listener: (method: "heuristic" | "llm") => void): () => void {
    this.compactListeners.push(listener);
    return () => {
      const i = this.compactListeners.indexOf(listener);
      if (i >= 0) this.compactListeners.splice(i, 1);
    };
  }

  private emitCompact(method: "heuristic" | "llm"): void {
    for (const fn of this.compactListeners) {
      try { fn(method); } catch { /* listener errors are non-fatal */ }
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /** Set the compaction token budget (typically derived from the model's window). */
  setMaxTokens(n: number): void {
    if (n > 0) this.maxTokens = n;
  }

  getMaxTokens(): number {
    return this.maxTokens;
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

  toAIMessages(): AIChatMessage[] {
    const messages: AIChatMessage[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    for (const msg of this.messages) {
      const out: AIChatMessage = { role: msg.role, content: msg.content };
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

  compact(): boolean {
    if (this.messages.length <= 6) return false;

    const recent = this.messages.slice(-6);
    const older = this.messages.slice(0, -6);

    const summaryParts: string[] = [];
    let currentRole = "";
    let currentSummary = "";

    for (const m of older) {
      if (m.role === currentRole) {
        currentSummary += " " + m.content.slice(0, 150);
      } else {
        if (currentSummary) {
          summaryParts.push(`${currentRole}: ${currentSummary.trim()}`);
        }
        currentRole = m.role;
        currentSummary = m.content.slice(0, 300);
      }
    }
    if (currentSummary) {
      summaryParts.push(`${currentRole}: ${currentSummary.trim()}`);
    }

    const summaryMessage: ConversationMessage = {
      role: "system",
      content: `[Context summary - ${older.length} earlier messages compressed]\n${summaryParts.join("\n")}`,
      timestamp: Date.now(),
      tokenEstimate: estimateTokens(summaryParts.join("\n")),
    };

    this.messages = [summaryMessage, ...recent];
    log.info(`Context compacted: ${older.length + 6} -> ${this.messages.length} messages`);
    this.emitCompact("heuristic");
    return true;
  }

  async compactWithLLM(
    summarize: (texts: string[]) => Promise<string>
  ): Promise<boolean> {
    if (this.messages.length <= 6) return false;

    try {
      const recent = this.messages.slice(-6);
      const older = this.messages.slice(0, -6);

      // Split older messages into blocks of up to 5
      const summaries: ConversationMessage[] = [];
      for (let i = 0; i < older.length; i += 5) {
        const block = older.slice(i, i + 5);
        const texts = block.map(
          (m) => `[${m.role}] ${m.content.slice(0, 300)}`
        );
        const summary = await summarize(texts);
        summaries.push({
          role: "system",
          content: `[LLM summary — ${block.length} messages]\n${summary}`,
          timestamp: block[block.length - 1].timestamp,
          tokenEstimate: estimateTokens(summary),
        });
      }

      this.messages = [...summaries, ...recent];
      log.info(
        `Context compacted with LLM: ${older.length + 6} -> ${this.messages.length} messages`
      );
      this.emitCompact("llm");
      return true;
    } catch (err) {
      log.warn(`LLM compaction failed, falling back to compact(): ${String(err)}`);
      return this.compact();
    }
  }

  private autoCompact(): void {
    // Safety net: a single round's tool output can push the token total past
    // the budget between rounds (the LLM compactor only runs at round start).
    // This heuristic pass keeps the conversation under the limit. compact()
    // emits the event, so the TUI can surface that it happened.
    log.warn(`Auto-compacting context (tokens: ${this.getTotalTokens()} / budget ${this.maxTokens})`);
    this.compact();
  }

  getTotalTokens(): number {
    // Include the system prompt — it's sent on every request, so omitting it
    // makes compaction trigger late and under-reports context utilization.
    const sys = this.systemPrompt ? estimateTokens(this.systemPrompt) : 0;
    return sys + this.messages.reduce((sum, m) => sum + (m.tokenEstimate || estimateTokens(m.content)), 0);
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
