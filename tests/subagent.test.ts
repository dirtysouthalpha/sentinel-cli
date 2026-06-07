import { describe, it, expect } from "vitest";
import { createSubagentTool, createSubagentAwareExecutor, SUBAGENT_TOOL_NAME } from "../src/core/subagent.js";
import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ToolCall,
} from "../src/ai/types.js";

/** Scripted provider: each chatStream() call returns the next response. */
class FakeProvider implements AIProvider {
  name = "fake";
  calls = 0;
  seenMessages: ChatMessage[][] = [];
  constructor(private script: ChatResponse[]) {}
  async chat(): Promise<ChatResponse> {
    throw new Error("not used");
  }
  async chatStream(
    messages: ChatMessage[],
    _options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    this.seenMessages.push(messages);
    const res = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls += 1;
    if (res.content && onChunk) onChunk({ content: res.content, done: false });
    if (onChunk) onChunk({ content: "", done: true });
    return res;
  }
  isAvailable(): boolean {
    return true;
  }
}

const tc = (name: string, args: Record<string, unknown>, id = `id_${name}`): ToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

describe("subagent", () => {
  it("runs an isolated child loop and returns its final content", async () => {
    // Child: one tool call (bash), then a final answer.
    const provider = new FakeProvider([
      { content: "", model: "m", toolCalls: [tc("bash", { command: "ls" })] },
      { content: "Found 3 TODOs in src/.", model: "m" },
    ]);
    let childToolRan = false;
    const handle = createSubagentTool({
      provider,
      toolDefs: [],
      executeTool: async (call) => {
        childToolRan = true;
        return { role: "tool", content: `ran ${call.name}`, name: call.name, toolCallId: call.id };
      },
      extractToolCalls: () => null,
      systemPrompt: "BASE PROMPT",
    });

    const out = await handle.execute({ task: "count TODOs", context: "look in src/" });

    expect(out).toBe("Found 3 TODOs in src/.");
    expect(childToolRan).toBe(true);
    // Isolation: the child's system prompt includes the base + subagent framing,
    // and the task+context were delivered as the first user message.
    const firstCall = provider.seenMessages[0];
    expect(firstCall[0].role).toBe("system");
    expect(firstCall[0].content).toContain("BASE PROMPT");
    expect(firstCall[0].content).toContain("focused subagent");
    expect(firstCall.at(-1)?.content).toContain("count TODOs");
    expect(firstCall.at(-1)?.content).toContain("look in src/");
  });

  it("flags an incomplete result when the child hits its round cap", async () => {
    const provider = new FakeProvider([
      { content: "", model: "m", toolCalls: [tc("bash", { command: "loop" })] },
    ]);
    const handle = createSubagentTool({
      provider,
      toolDefs: [],
      executeTool: async (call) => ({ role: "tool", content: "ok", name: call.name, toolCallId: call.id }),
      extractToolCalls: () => null,
      maxRounds: 2,
    });
    const out = await handle.execute({ task: "spin" });
    expect(out).toMatch(/round limit/);
  });

  it("rejects an empty task", async () => {
    const provider = new FakeProvider([{ content: "x", model: "m" }]);
    const handle = createSubagentTool({ provider, toolDefs: [], executeTool: async (c) => ({ role: "tool", content: "", name: c.name }), extractToolCalls: () => null });
    expect(await handle.execute({ task: "   " })).toMatch(/non-empty/);
    expect(provider.calls).toBe(0); // never invoked the model
  });

  it("aware executor intercepts only the subagent tool, passes others through", async () => {
    const provider = new FakeProvider([{ content: "done", model: "m" }]);
    const handle = createSubagentTool({ provider, toolDefs: [], executeTool: async (c) => ({ role: "tool", content: "", name: c.name }), extractToolCalls: () => null });

    let baseCalled = 0;
    const base = async (call: ToolCall): Promise<ChatMessage> => {
      baseCalled += 1;
      return { role: "tool", content: `base:${call.name}`, name: call.name, toolCallId: call.id };
    };
    const exec = createSubagentAwareExecutor(handle, base);

    const passthrough = await exec(tc("bash", { command: "ls" }));
    expect(passthrough.content).toBe("base:bash");
    expect(baseCalled).toBe(1);

    const delegated = await exec(tc(SUBAGENT_TOOL_NAME, { task: "do it" }));
    expect(delegated.content).toBe("done");
    expect(baseCalled).toBe(1); // base NOT called for the subagent tool
  });
});
