import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRunner } from "../src/core/agent-runner.js";
import { toolManager } from "../src/tools/index.js";
import { getToolDefinitions, executeToolCall } from "../src/tools/tool-executor.js";
import { ContextManager } from "../src/ai/context.js";
import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ToolCall,
} from "../src/ai/types.js";

/** Scripted provider: one ChatResponse per chatStream() call. */
class ScriptProvider implements AIProvider {
  name = "script";
  calls = 0;
  constructor(private script: ChatResponse[]) {}
  async chat(): Promise<ChatResponse> { throw new Error("unused"); }
  async chatStream(_m: ChatMessage[], _o?: ChatOptions, onChunk?: (c: StreamChunk) => void): Promise<ChatResponse> {
    const r = this.script[Math.min(this.calls++, this.script.length - 1)];
    if (r.content && onChunk) onChunk({ content: r.content, done: false });
    if (onChunk) onChunk({ content: "", done: true });
    return r;
  }
  isAvailable(): boolean { return true; }
}

function call(name: string, args: object): ToolCall {
  return { id: `c${Math.random()}`, name, arguments: JSON.stringify(args) };
}

/**
 * End-to-end: the agent loop dispatches a tool call through the REAL executor +
 * toolManager + file tool, mutating a real file on disk — exercising the whole
 * pipeline that the per-component unit tests only cover in isolation.
 */
describe("agent integration (real tools)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sentinel-int-"));
    toolManager.initialize(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  function runner(provider: AIProvider) {
    return new AgentRunner(
      {
        provider,
        context: new ContextManager("int"),
        toolDefs: getToolDefinitions(),
        executeTool: (tc) => executeToolCall(tc),
        extractToolCalls: () => null,
      },
      { maxRounds: 5 }
    );
  }

  it("applies a real file edit through the full loop", async () => {
    writeFileSync(join(dir, "a.ts"), "const x = 1;\n", "utf8");
    const provider = new ScriptProvider([
      { content: "", model: "m", toolCalls: [call("file", { action: "edit", path: "a.ts", searchLines: ["const x = 1;"], replaceText: "const x = 2;" })] },
      { content: "done", model: "m" },
    ]);

    const result = await runner(provider).run("change x to 2");

    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("const x = 2;\n");
    expect(result.stopReason).toBe("no_tool_calls");
  });

  it("writes then reads a file back through the loop", async () => {
    const provider = new ScriptProvider([
      { content: "", model: "m", toolCalls: [call("file", { action: "write", path: "new.txt", content: "hello" })] },
      { content: "", model: "m", toolCalls: [call("file", { action: "read", path: "new.txt" })] },
      { content: "done", model: "m" },
    ]);

    await runner(provider).run("create and read new.txt");

    expect(readFileSync(join(dir, "new.txt"), "utf8")).toBe("hello");
  });

  it("surfaces an ambiguous-edit failure without mutating the file", async () => {
    writeFileSync(join(dir, "dup.ts"), "a;\na;\n", "utf8");
    const provider = new ScriptProvider([
      { content: "", model: "m", toolCalls: [call("file", { action: "edit", path: "dup.ts", searchLines: ["a;"], replaceText: "b;" })] },
      { content: "done", model: "m" },
    ]);

    await runner(provider).run("edit dup");

    // The uniqueness guard rejected it — file unchanged.
    expect(readFileSync(join(dir, "dup.ts"), "utf8")).toBe("a;\na;\n");
  });
});
