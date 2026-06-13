import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiProvider } from "../src/ai/providers/gemini.js";

function sse(lines: string[]): Response {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("GeminiProvider streaming", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses text deltas, including data: without a space", async () => {
    const lines = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello" }] } }] })}`,
      // no space after data:
      `data:${JSON.stringify({ candidates: [{ content: { parts: [{ text: " world" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 } })}`,
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sse(lines)));

    const p = new GeminiProvider({ apiKey: "test" } as never);
    const res = await p.chatStream([{ role: "user", content: "hi" }], {});
    expect(res.content).toBe("Hello world");
    expect(res.usage).toEqual({ promptTokens: 5, completionTokens: 3, totalTokens: 8 });
  });

  it("captures a functionCall as a tool call", async () => {
    const lines = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "file", args: { action: "read", path: "a" } } }] } }] })}`,
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sse(lines)));

    const p = new GeminiProvider({ apiKey: "test" } as never);
    const res = await p.chatStream([{ role: "user", content: "read a" }], {});
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].name).toBe("file");
    expect(JSON.parse(res.toolCalls![0].arguments)).toEqual({ action: "read", path: "a" });
  });
});
