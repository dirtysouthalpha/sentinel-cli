import { describe, it, expect } from "vitest";
import {
  createSubagentTool,
  extractFirstJson,
  validateAgainstSchema,
  SUBAGENT_TOOL_NAME,
} from "../src/core/subagent.js";
import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
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

const makeHandle = (responses: ChatResponse[]) =>
  createSubagentTool({
    provider: new FakeProvider(responses),
    toolDefs: [],
    executeTool: async (c) => ({ role: "tool", content: "", name: c.name, toolCallId: c.id }),
    extractToolCalls: () => null,
  });

const personSchema = {
  type: "object",
  properties: { name: { type: "string" }, age: { type: "integer" } },
  required: ["name", "age"],
};

describe("extractFirstJson", () => {
  it("parses raw JSON", () => {
    expect(extractFirstJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses JSON inside ```json fences", () => {
    expect(extractFirstJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("extracts the first balanced object from surrounding prose", () => {
    expect(extractFirstJson('Here you go:\n{"a": {"b": 2}} -- done')).toEqual({ a: { b: 2 } });
  });
  it("extracts a balanced array even with nested objects/brackets in strings", () => {
    expect(extractFirstJson('result = [{"x": "]["}, 2]')).toEqual([{ x: "][" }, 2]);
  });
  it("returns undefined when no JSON is present", () => {
    expect(extractFirstJson("no json here")).toBeUndefined();
  });
});

describe("validateAgainstSchema", () => {
  it("passes a conforming object", () => {
    expect(validateAgainstSchema({ name: "a", age: 3 }, personSchema)).toEqual([]);
  });
  it("flags a missing required key", () => {
    expect(validateAgainstSchema({ name: "a" }, personSchema)).toHaveLength(1);
    expect(validateAgainstSchema({ name: "a" }, personSchema)[0]).toMatch(/age.*missing required/);
  });
  it("flags a type mismatch", () => {
    const errs = validateAgainstSchema({ name: "a", age: "3" }, personSchema);
    expect(errs.join()).toMatch(/age.*expected integer/);
  });
  it("validates array items", () => {
    const schema = { type: "array", items: { type: "number" } };
    expect(validateAgainstSchema([1, 2], schema)).toEqual([]);
    expect(validateAgainstSchema([1, "x"], schema)).toHaveLength(1);
  });
});

describe("subagent schema mode", () => {
  it("returns pretty-printed validated JSON when the child emits matching JSON", async () => {
    const handle = makeHandle([{ content: '{"name":"Ada","age":36}', model: "m" }]);
    const out = await handle.execute({ task: "describe", outputSchema: personSchema });
    expect(out).toBe(JSON.stringify({ name: "Ada", age: 36 }, null, 2));
  });

  it("parses fenced JSON from the child", async () => {
    const handle = makeHandle([{ content: 'Sure!\n```json\n{"name":"Ada","age":36}\n```', model: "m" }]);
    const out = await handle.execute({ task: "describe", outputSchema: personSchema });
    expect(JSON.parse(out)).toEqual({ name: "Ada", age: 36 });
  });

  it("errors when a required key is missing", async () => {
    const handle = makeHandle([{ content: '{"name":"Ada"}', model: "m" }]);
    const out = await handle.execute({ task: "describe", outputSchema: personSchema });
    expect(out).toMatch(/^ERROR: subagent did not return valid JSON for schema/);
    expect(out).toMatch(/age.*missing required/);
    expect(out).toContain("Ada"); // raw output echoed back
  });

  it("errors when the child returns no parseable JSON", async () => {
    const handle = makeHandle([{ content: "I could not do it.", model: "m" }]);
    const out = await handle.execute({ task: "describe", outputSchema: personSchema });
    expect(out).toMatch(/^ERROR: subagent did not return valid JSON for schema/);
    expect(out).toContain("I could not do it.");
  });

  it("appends the schema instruction to the child's task", async () => {
    const provider = new FakeProvider([{ content: '{"name":"Ada","age":36}', model: "m" }]);
    const handle = createSubagentTool({
      provider,
      toolDefs: [],
      executeTool: async (c) => ({ role: "tool", content: "", name: c.name, toolCallId: c.id }),
      extractToolCalls: () => null,
    });
    await handle.execute({ task: "describe", outputSchema: personSchema });
    const lastUserMsg = provider.seenMessages[0].at(-1)?.content ?? "";
    expect(lastUserMsg).toContain("ONLY a single JSON value");
    expect(lastUserMsg).toContain('"required"');
  });

  it("no-schema path is unchanged: returns trimmed text", async () => {
    const handle = makeHandle([{ content: "  plain answer  ", model: "m" }]);
    const out = await handle.execute({ task: "describe" });
    expect(out).toBe("plain answer");
  });

  it("exposes outputSchema in the tool definition", () => {
    const handle = makeHandle([{ content: "x", model: "m" }]);
    const props = handle.def.function.parameters.properties;
    expect(props.outputSchema).toBeDefined();
    expect(handle.def.function.name).toBe(SUBAGENT_TOOL_NAME);
    expect(handle.def.function.parameters.required).toEqual(["task"]);
  });
});
