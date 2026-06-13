import { describe, it, expect } from "vitest";
import { parseOpenAIResponse, buildRequestBody } from "../src/ai/providers/openai-compat.js";

describe("parseOpenAIResponse", () => {
  it("parses plain content", () => {
    const r = parseOpenAIResponse({ model: "m", choices: [{ message: { content: "hi" }, finish_reason: "stop" }] } as never);
    expect(r.content).toBe("hi");
    expect(r.finishReason).toBe("stop");
    expect(r.toolCalls).toBeUndefined();
  });

  it("parses well-formed tool calls", () => {
    const r = parseOpenAIResponse({
      model: "m",
      choices: [{ message: { tool_calls: [{ id: "c1", type: "function", function: { name: "file", arguments: "{}" } }] } }],
    } as never);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls![0].name).toBe("file");
  });

  it("does not throw on a malformed tool call (missing function); drops it", () => {
    const r = parseOpenAIResponse({
      model: "m",
      choices: [{ message: { tool_calls: [{ id: "bad", type: "function" }, { id: "ok", type: "function", function: { name: "bash", arguments: "{}" } }] } }],
    } as never);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls![0].name).toBe("bash");
  });

  it("handles empty/missing choices", () => {
    expect(parseOpenAIResponse({ model: "m", choices: [] } as never).content).toBe("");
  });

  it("maps usage fields", () => {
    const r = parseOpenAIResponse({ model: "m", choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } } as never);
    expect(r.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
  });
});

describe("buildRequestBody", () => {
  it("includes model, messages, and tools; prepends systemPrompt", () => {
    const body = buildRequestBody(
      [{ role: "user", content: "hi" }],
      { systemPrompt: "be terse", tools: [{ type: "function", function: { name: "file", description: "", parameters: {} } }] },
      "default/model",
      false
    );
    expect(body.model).toBe("default/model");
    expect((body.messages as unknown[])[0]).toMatchObject({ role: "system", content: "be terse" });
    expect(body.tools).toHaveLength(1);
    expect(body.stream).toBe(false);
  });
});
