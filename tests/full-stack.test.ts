import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRunner } from "../src/core/agent-runner.js";
import { toolManager } from "../src/tools/index.js";
import { getToolDefinitions, executeToolCall } from "../src/tools/tool-executor.js";
import { ContextManager } from "../src/ai/context.js";
import { CustomProvider } from "../src/ai/providers/custom.js";

function sse(lines: string[]): Response {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const d = (o: object) => `data: ${JSON.stringify(o)}`;

/**
 * Full stack with only the network mocked: the model's streamed OpenAI SSE is
 * parsed by the real provider, the agent loop dispatches the tool call through
 * the real executor + toolManager + file tool, and a real file changes on disk.
 */
describe("full stack (real SSE parse -> agent loop -> real file tool)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sentinel-fs-"));
    toolManager.initialize(dir);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("streams a tool call and applies it to disk", async () => {
    writeFileSync(join(dir, "a.ts"), "const x = 1;\n", "utf8");

    const editArgs = JSON.stringify({
      action: "edit",
      path: "a.ts",
      searchLines: ["const x = 1;"],
      replaceText: "const x = 2;",
    });

    // Round 1: stream a file-edit tool call (id, then accumulated arguments).
    const round1 = sse([
      d({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "file", arguments: "" } }] } }] }),
      d({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: editArgs } }] } }] }),
      d({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      "data: [DONE]",
    ]);
    // Round 2: plain text -> loop ends.
    const round2 = sse([d({ choices: [{ delta: { content: "done" } }] }), "data: [DONE]"]);

    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? round1 : round2)));

    const provider = new CustomProvider("test", { baseURL: "http://mock", apiKey: "k", defaultModel: "m" } as never);
    const runner = new AgentRunner(
      {
        provider,
        context: new ContextManager("fs"),
        toolDefs: getToolDefinitions(),
        executeTool: (tc) => executeToolCall(tc),
        extractToolCalls: () => null,
      },
      { maxRounds: 5 }
    );

    const result = await runner.run("change x to 2");

    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("const x = 2;\n");
    expect(result.stopReason).toBe("no_tool_calls");
    expect(n).toBe(2); // one tool round + one closing round
  });
});
