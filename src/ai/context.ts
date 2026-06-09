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

  compact(): void {
    if (this.messages.length <= 6) return;

    // Choose the cut so the recent window never *starts* on a tool message
    // whose owning assistant(tool_calls) turn would be summarized away. Splitting
    // an assistant->tool pair breaks providers that require a tool message to
    // follow its tool_calls (OpenAI 400). Walk the boundary back past any
    // leading tool results so each kept pair stays intact.
    let cut = this.messages.length - 6;
    while (cut > 0 && this.messages[cut].role === "tool") {
      cut--;
    }

    const older = this.messages.slice(0, cut);
    const recent = this.messages.slice(cut);
    if (older.length === 0) return;

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

    const summaryText = summaryParts.join("\n");
    // Keep the summary as a "user" note, NOT a system message — a system-role
    // entry here would overwrite the real system prompt on Anthropic.
    const summaryMessage: ConversationMessage = {
      role: "user",
      content: `[Earlier conversation summary — ${older.length} messages compacted]\n${summaryText}`,
      timestamp: Date.now(),
      tokenEstimate: estimateTokens(summaryText),
    };

    this.messages = [summaryMessage, ...recent];
    log.info(`Context compacted: ${older.length + recent.length} -> ${this.messages.length} messages`);
  }

  private autoCompact(): void {
    log.info(`Auto-compacting context (tokens: ${this.getTotalTokens()})`);
    this.compact();
  }

  getTotalTokens(): number {
    return this.messages.reduce((sum, m) => sum + (m.tokenEstimate || estimateTokens(m.content)), 0);
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
