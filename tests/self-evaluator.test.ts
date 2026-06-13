import { describe, it, expect, vi } from "vitest";
import { evaluateRound, EvalResult } from "../src/core/self-evaluator.js";
import type { AIProvider, ChatResponse, ChatMessage } from "../src/ai/types.js";

function mockProvider(content: string, usage?: { promptTokens: number; completionTokens: number; totalTokens: number }): AIProvider {
  return {
    name: "mock",
    chat: vi.fn().mockResolvedValue({ content, usage }),
    chatStream: vi.fn().mockResolvedValue({ content, usage }),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as AIProvider;
}

const messages: ChatMessage[] = [
  { role: "user", content: "fix the bug" },
  { role: "assistant", content: "done", metadata: { toolCalls: [] } },
];

describe("evaluateRound", () => {
  it("returns complete when model says TASK_COMPLETE", async () => {
    const provider = mockProvider("TASK_COMPLETE");
    const result = await evaluateRound(messages, provider);
    expect(result.result).toBe("complete");
  });

  it("returns stuck when model says TASK_STUCK", async () => {
    const provider = mockProvider("TASK_STUCK");
    const result = await evaluateRound(messages, provider);
    expect(result.result).toBe("stuck");
  });

  it("returns continue for other responses", async () => {
    const provider = mockProvider("Need to run tests next");
    const result = await evaluateRound(messages, provider);
    expect(result.result).toBe("continue");
    expect(result.assessment).toBe("Need to run tests next");
  });

  it("returns continue on provider error", async () => {
    const provider = {
      name: "mock",
      chat: vi.fn().mockRejectedValue(new Error("fail")),
      chatStream: vi.fn().mockRejectedValue(new Error("fail")),
      isAvailable: vi.fn().mockReturnValue(true),
    } as unknown as AIProvider;
    const result = await evaluateRound(messages, provider);
    expect(result.result).toBe("continue");
  });

  it("passes usage through", async () => {
    const usage = { promptTokens: 50, completionTokens: 10, totalTokens: 60 };
    const provider = mockProvider("TASK_COMPLETE", usage);
    const result = await evaluateRound(messages, provider);
    expect(result.usage).toEqual(usage);
  });
});
