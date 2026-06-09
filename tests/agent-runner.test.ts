import { describe, it, expect, vi } from "vitest";
import {
  AgentRunner,
  ContextManagerLike,
} from "../src/core/agent-runner.js";
import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ToolCall,
} from "../src/ai/types.js";

// ---- fakes ------------------------------------------------------------------

class FakeContext implements ContextManagerLike {
  systemPrompt = "";
  messages: ChatMessage[] = [];
  totalTokens = 0;

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
}

/** Scripted provider: each entry corresponds to one chatStream() call. */
class FakeProvider implements AIProvider {
  name = "fake";
  calls = 0;
  constructor(private script: ChatResponse[]) {}

  async chat(): Promise<ChatResponse> {
    throw new Error("not used");
  }

  async chatStream(
    _messages: ChatMessage[],
    _options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const res = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls += 1;
    if (res.content && onChunk) {
      onChunk({ content: res.content, done: false });
    }
    if (onChunk) onChunk({ content: "", done: true });
    return res;
  }

  isAvailable(): boolean {
    return true;
  }
}

function toolCall(name: string, args: Record<string, unknown>, id = `id_${name}`): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function okTool(tc: ToolCall): Promise<ChatMessage> {
  return Promise.resolve({ role: "tool", content: `OK ran ${tc.name}`, name: tc.name });
}

function makeDeps(provider: AIProvider, context: ContextManagerLike, overrides = {}) {
  return {
    provider,
    context,
    toolDefs: [],
    executeTool: okTool,
    extractToolCalls: (_c: string) => null,
    ...overrides,
  };
}

// ---- tests ------------------------------------------------------------------

describe("AgentRunner", () => {
  it("(a) respects maxRounds cap and clamps rounds (no off-by-one)", async () => {
    // Always returns a tool call -> would loop forever without the cap.
    const provider = new FakeProvider([
      { content: "", model: "m", toolCalls: [toolCall("bash", { command: "x" })] },
    ]);
    const ctx = new FakeContext();
    const runner = new AgentRunner(makeDeps(provider, ctx), { maxRounds: 3 });

    const result = await runner.run("go");

    expect(result.rounds).toBe(3);
    expect(result.stopReason).toBe("max_rounds");
    expect(provider.calls).toBe(3);
  });

  it("(b) prefers native toolCalls over text fallback", async () => {
    const native = [toolCall("native_tool", { a: 1 })];
    const provider = new FakeProvider([
      { content: "```bash\nls\n```", model: "m", toolCalls: native },
      { content: "done", model: "m" },
    ]);
    const ctx = new FakeContext();
    const seen: string[] = [];
    const runner = new AgentRunner(
      makeDeps(provider, ctx, {
        executeTool: (tc: ToolCall) => {
          seen.push(tc.name);
          return okTool(tc);
        },
        // text fallback would yield "bash" — must NOT be used when native exists.
        extractToolCalls: (content: string) =>
          content.includes("```bash") ? [toolCall("bash", { command: "ls" })] : null,
      }),
      { maxRounds: 5 }
    );

    await runner.run("go");
    expect(seen).toEqual(["native_tool"]);
  });

  it("(c) appends tool result with {toolCallId, name} metadata", async () => {
    const tc = toolCall("read_file", { path: "a" }, "call_42");
    const provider = new FakeProvider([
      { content: "", model: "m", toolCalls: [tc] },
      { content: "finished", model: "m" },
    ]);
    const ctx = new FakeContext();
    const runner = new AgentRunner(makeDeps(provider, ctx), { maxRounds: 5 });

    await runner.run("go");

    const toolMsg = ctx.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolCallId).toBe("call_42");
    expect(toolMsg!.name).toBe("read_file");
    expect(toolMsg!.content).toContain("[Tool: read_file]");
  });

  it("(d) emits events in order roundStart->token->streamEnd->toolStart->toolResult->roundEnd", async () => {
    const tc = toolCall("bash", { command: "ls" });
    const provider = new FakeProvider([
      { content: "thinking", model: "m", toolCalls: [tc] },
      { content: "done", model: "m" },
    ]);
    const ctx = new FakeContext();
    const runner = new AgentRunner(makeDeps(provider, ctx), { maxRounds: 5 });

    const order: string[] = [];
    runner.on("roundStart", () => order.push("roundStart"));
    runner.on("token", () => order.push("token"));
    runner.on("streamEnd", () => order.push("streamEnd"));
    runner.on("toolStart", () => order.push("toolStart"));
    runner.on("toolResult", () => order.push("toolResult"));
    runner.on("roundEnd", () => order.push("roundEnd"));

    await runner.run("go");

    // First round's prefix:
    expect(order.slice(0, 6)).toEqual([
      "roundStart",
      "token",
      "streamEnd",
      "toolStart",
      "toolResult",
      "roundEnd",
    ]);
  });

  it("(e) AbortSignal stops before running tools", async () => {
    const tc = toolCall("bash", { command: "ls" });
    const provider = new FakeProvider([
      { content: "", model: "m", toolCalls: [tc] },
    ]);
    const ctx = new FakeContext();
    const executeTool = vi.fn((t: ToolCall) => okTool(t));
    const controller = new AbortController();
    controller.abort();

    const runner = new AgentRunner(makeDeps(provider, ctx, { executeTool }), { maxRounds: 5 });
    const result = await runner.run("go", controller.signal);

    expect(result.stopReason).toBe("aborted");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("(f) provider throw => runError emitted, stopReason error, no crash", async () => {
    const provider: AIProvider = {
      name: "boom",
      chat: async () => {
        throw new Error("nope");
      },
      chatStream: async () => {
        throw new Error("stream boom");
      },
      isAvailable: () => true,
    };
    const ctx = new FakeContext();
    const runner = new AgentRunner(makeDeps(provider, ctx), { maxRounds: 5 });

    const errors: unknown[] = [];
    let doneResult: unknown;
    runner.on("runError", (e) => errors.push(e));
    runner.on("done", (r) => (doneResult = r));

    const result = await runner.run("go");

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("stream boom");
    expect(result.stopReason).toBe("error");
    expect(doneResult).toBe(result);
  });

  it("(f2) forwards the AbortSignal into chatStream options (so the network call can abort)", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const provider: AIProvider = {
      name: "spy",
      chat: async () => {
        throw new Error("unused");
      },
      chatStream: async (_m: ChatMessage[], options?: ChatOptions) => {
        seenSignal = options?.signal;
        return { content: "done", model: "m" } as ChatResponse;
      },
      isAvailable: () => true,
    };
    const ctx = new FakeContext();
    const runner = new AgentRunner(makeDeps(provider, ctx), { maxRounds: 2 });

    await runner.run("go", controller.signal);
    expect(seenSignal).toBe(controller.signal);
  });

  it("(f3) treats a mid-stream AbortError as aborted, not an error (no runError)", async () => {
    const controller = new AbortController();
    const provider: AIProvider = {
      name: "abrt",
      chat: async () => {
        throw new Error("unused");
      },
      chatStream: async () => {
        controller.abort();
        const e = new Error("The operation was aborted");
        e.name = "AbortError";
        throw e;
      },
      isAvailable: () => true,
    };
    const ctx = new FakeContext();
    const runner = new AgentRunner(makeDeps(provider, ctx), { maxRounds: 2 });

    const errors: unknown[] = [];
    runner.on("runError", (e) => errors.push(e));

    const result = await runner.run("go", controller.signal);
    expect(result.stopReason).toBe("aborted");
    expect(errors).toHaveLength(0);
  });

  it("(g) aggregates usage across rounds", async () => {
    const tc = toolCall("bash", { command: "ls" });
    const provider = new FakeProvider([
      {
        content: "",
        model: "m",
        toolCalls: [tc],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      {
        content: "done",
        model: "m",
        usage: { promptTokens: 20, completionTokens: 7, totalTokens: 27 },
      },
    ]);
    const ctx = new FakeContext();
    const runner = new AgentRunner(makeDeps(provider, ctx), { maxRounds: 5 });

    const result = await runner.run("go");

    expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 12, totalTokens: 42 });
  });

  it("(h) adds assistant message when content empty but toolCalls present", async () => {
    const tc = toolCall("bash", { command: "ls" });
    const provider = new FakeProvider([
      { content: "", model: "m", toolCalls: [tc] },
      { content: "done", model: "m" },
    ]);
    const ctx = new FakeContext();
    const runner = new AgentRunner(makeDeps(provider, ctx), { maxRounds: 5 });

    await runner.run("go");

    const assistantMsgs = ctx.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    const emptyWithCalls = assistantMsgs.find((m) => m.content === "" && m.toolCalls);
    expect(emptyWithCalls).toBeDefined();
    expect(emptyWithCalls!.toolCalls).toHaveLength(1);
  });

  it("stops cleanly with no_tool_calls when model returns plain text", async () => {
    const provider = new FakeProvider([{ content: "all done", model: "m" }]);
    const ctx = new FakeContext();
    const runner = new AgentRunner(makeDeps(provider, ctx), { maxRounds: 5 });

    const result = await runner.run("go");

    expect(result.rounds).toBe(1);
    expect(result.stopReason).toBe("no_tool_calls");
    expect(result.finalContent).toBe("all done");
  });
});
