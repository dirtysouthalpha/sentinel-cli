import { describe, it, expect, vi } from "vitest";
import { AgentRunner, ContextManagerLike } from "../src/core/agent-runner.js";
import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ToolCall,
} from "../src/ai/types.js";

/** Context fake that records compaction calls. Supports both ensureUnder
 *  (the old path) and compactWithSummarizer (the new model-driven path). */
class FakeContext implements ContextManagerLike {
  systemPrompt = "";
  messages: ChatMessage[] = [];
  totalTokens = 0;
  ensureUnderCalls = 0;
  summarizeCalls = 0;

  setSystemPrompt(p: string): void {
    this.systemPrompt = p;
  }
  toAIMessages(): ChatMessage[] {
    const out: ChatMessage[] = [];
    if (this.systemPrompt) out.push({ role: "system", content: this.systemPrompt });
    return out.concat(this.messages);
  }
  addMessage(
    role: "user" | "assistant" | "tool",
    content: string,
    metadata?: Record<string, unknown>
  ): void {
    const msg: ChatMessage = { role, content };
    if (metadata) {
      if (metadata.toolCalls) msg.toolCalls = metadata.toolCalls as ToolCall[];
      if (metadata.toolCallId) msg.toolCallId = metadata.toolCallId as string;
      if (metadata.name) msg.name = metadata.name as string;
    }
    this.messages.push(msg);
    this.totalTokens += content.length;
  }
  getMessageCount(): number {
    return this.messages.length;
  }
  getTotalTokens(): number {
    return this.totalTokens;
  }
  ensureUnder(): number {
    this.ensureUnderCalls++;
    this.totalTokens = Math.floor(this.totalTokens / 2); // simulate compaction
    return this.totalTokens;
  }
  async compactWithSummarizer(summarize: (unitTexts: string[]) => Promise<string>): Promise<void> {
    this.summarizeCalls++;
    // Pretend to summarize: invoke the summarizer, then shrink tokens.
    await summarize(["unit-one-text", "unit-two-text"]);
    this.totalTokens = Math.floor(this.totalTokens / 2);
  }
}

/** Provider that overflows the FIRST call, then succeeds on retry. */
class OverflowThenSucceedProvider implements AIProvider {
  name = "fake";
  calls = 0;
  constructor(private okResponse: ChatResponse) {}
  async chat(): Promise<ChatResponse> {
    throw new Error("not used");
  }
  async chatStream(
    _messages: ChatMessage[],
    _options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    this.calls++;
    if (this.calls === 1) {
      // Simulate the model rejecting the prompt as too long.
      const err = Object.assign(new Error("This model's maximum context length is 8192 tokens"), {
        status: 400,
      });
      throw err;
    }
    if (this.okResponse.content && onChunk) onChunk({ content: this.okResponse.content, done: false });
    if (onChunk) onChunk({ content: "", done: true });
    return this.okResponse;
  }
}

const NO_TOOLS: ToolCall[] = [];

describe("AgentRunner — model-driven compaction on overflow", () => {
  it("uses compactWithSummarizer (model-driven) when a summarize fn is injected", async () => {
    const ctx = new FakeContext();
    ctx.totalTokens = 500000; // huge, will overflow
    ctx.addMessage("user", "do the thing");

    const provider = new OverflowThenSucceedProvider({
      content: "done",
      toolCalls: NO_TOOLS,
      usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
    });

    const summarize = vi.fn(async (unitTexts: string[]) => {
      // Confirm the runner handed us the archival unit texts.
      expect(unitTexts).toEqual(["unit-one-text", "unit-two-text"]);
      return "SUMMARY: the user asked to do the thing";
    });

    const runner = new AgentRunner(
      { provider, context: ctx, toolDefs: [], executeTool: async () => ({ role: "tool", content: "" }), extractToolCalls: () => NO_TOOLS, summarizeForCompaction: summarize },
      { maxRounds: 1 }
    );

    const result = await runner.run("do the thing");

    expect(result.stopReason).toBe("no_tool_calls");
    // The model-driven path was taken, not the lossy ensureUnder fallback.
    expect(ctx.summarizeCalls).toBe(1);
    expect(ctx.ensureUnderCalls).toBe(0);
    // The summarize fn we injected was actually called.
    expect(summarize).toHaveBeenCalledTimes(1);
    // The overflow was recovered: provider called twice (overflow + retry).
    expect(provider.calls).toBe(2);
  });

  it("falls back to ensureUnder when no summarize fn is injected", async () => {
    const ctx = new FakeContext();
    ctx.totalTokens = 500000;
    ctx.addMessage("user", "do the thing");

    const provider = new OverflowThenSucceedProvider({
      content: "done",
      toolCalls: NO_TOOLS,
      usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
    });

    // No summarizeForCompaction — old behavior.
    const runner = new AgentRunner(
      { provider, context: ctx, toolDefs: [], executeTool: async () => ({ role: "tool", content: "" }), extractToolCalls: () => NO_TOOLS },
      { maxRounds: 1 }
    );

    const result = await runner.run("do the thing");
    expect(result.stopReason).toBe("no_tool_calls");
    expect(ctx.ensureUnderCalls).toBe(1);
    expect(ctx.summarizeCalls).toBe(0);
  });

  it("falls back to ensureUnder when context lacks compactWithSummarizer", async () => {
    // A context that only implements ensureUnder (no async summarize). Even
    // with a summarize fn injected, the runner must fall back gracefully.
    class EnsureOnlyContext implements ContextManagerLike {
      systemPrompt = "";
      messages: ChatMessage[] = [];
      totalTokens = 500000;
      ensureUnderCalls = 0;
      setSystemPrompt(p: string) { this.systemPrompt = p; }
      toAIMessages(): ChatMessage[] {
        return this.systemPrompt ? [{ role: "system", content: this.systemPrompt }, ...this.messages] : this.messages;
      }
      addMessage(role: "user" | "assistant" | "tool", content: string) {
        this.messages.push({ role, content });
        this.totalTokens += content.length;
      }
      getMessageCount() { return this.messages.length; }
      getTotalTokens() { return this.totalTokens; }
      ensureUnder() { this.ensureUnderCalls++; this.totalTokens = Math.floor(this.totalTokens / 2); return this.totalTokens; }
      // NOTE: no compactWithSummarizer
    }
    const ctx = new EnsureOnlyContext();
    ctx.addMessage("user", "do the thing");

    const provider = new OverflowThenSucceedProvider({
      content: "done",
      toolCalls: NO_TOOLS,
      usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
    });

    const runner = new AgentRunner(
      { provider, context: ctx, toolDefs: [], executeTool: async () => ({ role: "tool", content: "" }), extractToolCalls: () => NO_TOOLS, summarizeForCompaction: async () => "summary" },
      { maxRounds: 1 }
    );

    const result = await runner.run("do the thing");
    expect(result.stopReason).toBe("no_tool_calls");
    // No compactWithSummarizer on the context → used ensureUnder instead.
    expect(ctx.ensureUnderCalls).toBe(1);
  });
});
