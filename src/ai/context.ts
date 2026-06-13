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

  compact(): void {
    if (this.messages.length <= 6) return;

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
  }

  async compactWithLLM(
    summarize: (texts: string[]) => Promise<string>
  ): Promise<void> {
    if (this.messages.length <= 6) return;

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
    } catch (err) {
      log.warn(`LLM compaction failed, falling back to compact(): ${String(err)}`);
      this.compact();
    }
  }

  private autoCompact(): void {
    log.info(`Auto-compacting context (tokens: ${this.getTotalTokens()})`);
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
