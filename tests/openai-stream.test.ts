import { describe, it, expect } from "vitest";
import { parseOpenAIStream } from "../src/ai/providers/openai-compat.js";

/** Build a Response whose body streams the given raw chunks. */
function sse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream);
}

const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

describe("parseOpenAIStream", () => {
  it("assembles content deltas (data: with space)", async () => {
    const res = await parseOpenAIStream(sse([delta("Hello"), delta(" world"), "data: [DONE]\n"]));
    expect(res.content).toBe("Hello world");
  });

  it("handles data: WITHOUT a space (spec-optional, some providers omit it)", async () => {
    const line = `data:${JSON.stringify({ choices: [{ delta: { content: "no-space" } }] })}\n`;
    const res = await parseOpenAIStream(sse([line, "data:[DONE]\n"]));
    expect(res.content).toBe("no-space");
  });

  it("accumulates a tool call across deltas", async () => {
    const c1 = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "file", arguments: '{"act' } }] } }] })}\n`;
    const c2 = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ion":"read"}' } }] } }] })}\n`;
    const res = await parseOpenAIStream(sse([c1, c2, "data: [DONE]\n"]));
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].name).toBe("file");
    expect(JSON.parse(res.toolCalls![0].arguments)).toEqual({ action: "read" });
  });

  it("reassembles a data line split across chunk boundaries", async () => {
    const full = delta("split-content");
    const mid = Math.floor(full.length / 2);
    const res = await parseOpenAIStream(sse([full.slice(0, mid), full.slice(mid), "data: [DONE]\n"]));
    expect(res.content).toBe("split-content");
  });

  it("processes a final event that lacks a trailing newline", async () => {
    // No trailing "\n" on the usage event — some proxies omit it.
    const usage = `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 } })}`;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(delta("hi") + usage));
        c.close();
      },
    });
    const res = await parseOpenAIStream(new Response(stream));
    expect(res.content).toBe("hi");
    expect(res.usage).toEqual({ promptTokens: 9, completionTokens: 1, totalTokens: 10 });
  });

  it("captures usage and finish_reason", async () => {
    const line = `data: ${JSON.stringify({ model: "m", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } })}\n`;
    const res = await parseOpenAIStream(sse([line, "data: [DONE]\n"]));
    expect(res.finishReason).toBe("stop");
    expect(res.usage).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
  });
});
