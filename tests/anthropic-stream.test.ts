import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicProvider } from "../src/ai/providers/anthropic.js";

function sseResponse(lines: string[]): Response {
  const body = lines.join("\n") + "\n";
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(body));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}
const d = (o: object) => `data: ${JSON.stringify(o)}`;

describe("AnthropicProvider streaming", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("captures a tool call from content_block_start + input_json_delta", async () => {
    const lines = [
      d({ type: "message_start", message: { model: "claude-opus-4-8" } }),
      d({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "file" } }),
      d({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"action":' } }),
      d({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"read"}' } }),
      d({ type: "message_delta", usage: { input_tokens: 10, output_tokens: 5 } }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(lines)));

    const p = new AnthropicProvider({ apiKey: "test" } as never);
    const res = await p.chatStream([{ role: "user", content: "read the file" }], { model: "claude-opus-4-8" });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].name).toBe("file");
    expect(res.toolCalls![0].id).toBe("toolu_1");
    expect(JSON.parse(res.toolCalls![0].arguments)).toEqual({ action: "read" });
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("streams text via text_delta", async () => {
    const lines = [
      d({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }),
      d({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(lines)));

    const p = new AnthropicProvider({ apiKey: "test" } as never);
    const chunks: string[] = [];
    const res = await p.chatStream([{ role: "user", content: "hi" }], {}, (c) => {
      if (c.content) chunks.push(c.content);
    });
    expect(res.content).toBe("Hello there");
    expect(chunks.join("")).toBe("Hello there");
  });
});
