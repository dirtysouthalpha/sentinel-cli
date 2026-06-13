import { describe, it, expect, vi } from "vitest";
import { PlanMode, PlanModeCallbacks, PlanModeResult } from "../src/core/plan-mode.js";
import { AgentRunnerDeps, ContextManagerLike } from "../src/core/agent-runner.js";
import { AIProvider, ChatMessage, ChatResponse, ChatOptions, StreamChunk, ToolCall } from "../src/ai/types.js";

class FakeContext implements ContextManagerLike {
  messages: ChatMessage[] = [];
  setSystemPrompt() {}
  toAIMessages() { return this.messages; }
  addMessage(role: string, content: string) {
    this.messages.push({ role: role as ChatMessage["role"], content });
  }
  getMessageCount() { return this.messages.length; }
  getTotalTokens() { return 0; }
}

class FakeProvider implements AIProvider {
  name = "fake";
  constructor(private script: ChatResponse[]) {}
  async chat(): Promise<ChatResponse> { throw new Error("not used"); }
  async chatStream(_m: ChatMessage[], _o?: ChatOptions, onChunk?: (c: StreamChunk) => void): Promise<ChatResponse> {
    const res = this.script.shift()!;
    if (res.content && onChunk) onChunk({ content: res.content, done: false });
    if (onChunk) onChunk({ content: "", done: true });
    return res;
  }
  isAvailable() { return true; }
}

const makeDeps = (p: AIProvider): AgentRunnerDeps => ({
  provider: p, context: new FakeContext(), toolDefs: [],
  executeTool: async (tc: ToolCall) => ({ role: "tool" as const, content: `ok ${tc.name}`, name: tc.name }),
  extractToolCalls: () => null,
});
const cb = (overrides: Partial<PlanModeCallbacks> = {}): PlanModeCallbacks => ({
  onPlanStart: vi.fn(), onPlanReady: vi.fn().mockResolvedValue(true), onExecutionStart: vi.fn(), ...overrides,
});

describe("PlanMode", () => {
  it("constructs with default config", () => {
    const pm = new PlanMode(makeDeps(new FakeProvider([])), cb());
    // @ts-expect-error accessing private for assertion
    expect(pm.config).toEqual({ maxResearchRounds: 5, maxExecutionRounds: 30 });
  });

  it("applies custom config overrides", () => {
    const pm = new PlanMode(makeDeps(new FakeProvider([])), cb(), { maxResearchRounds: 2, maxExecutionRounds: 10 });
    // @ts-expect-error accessing private for assertion
    expect(pm.config).toEqual({ maxResearchRounds: 2, maxExecutionRounds: 10 });
  });

  it("runs execution when plan is approved", async () => {
    const provider = new FakeProvider([{ content: "research plan", model: "fake" }, { content: "exec done", model: "fake" }]);
    const callbacks = cb();
    const result: PlanModeResult = await new PlanMode(makeDeps(provider), callbacks).run("do stuff");
    expect(callbacks.onPlanStart).toHaveBeenCalled();
    expect(callbacks.onPlanReady).toHaveBeenCalledWith("research plan");
    expect(callbacks.onExecutionStart).toHaveBeenCalled();
    expect(result).toEqual({ plan: "research plan", rounds: 2, approved: true, stopReason: "no_tool_calls" });
  });

  it("revises plan on rejection then proceeds if re-approved", async () => {
    const provider = new FakeProvider([
      { content: "plan v1", model: "fake" }, { content: "plan v2", model: "fake" }, { content: "exec done", model: "fake" },
    ]);
    let n = 0;
    const callbacks = cb({ onPlanReady: vi.fn().mockImplementation(() => Promise.resolve(++n > 1)) });
    const result = await new PlanMode(makeDeps(provider), callbacks).run("do stuff");
    expect(callbacks.onPlanReady).toHaveBeenCalledTimes(2);
    expect(result.plan).toBe("plan v2");
    expect(result.approved).toBe(true);
  });

  it("returns rejected result when aborted during approval", async () => {
    const ac = new AbortController(); ac.abort();
    const provider = new FakeProvider([{ content: "plan v1", model: "fake" }]);
    const callbacks = cb({ onPlanReady: vi.fn().mockResolvedValue(false) });
    const result = await new PlanMode(makeDeps(provider), callbacks).run("do stuff", ac.signal);
    expect(result.approved).toBe(false);
    expect(result.stopReason).toBe("aborted");
    expect(callbacks.onExecutionStart).not.toHaveBeenCalled();
  });
});
