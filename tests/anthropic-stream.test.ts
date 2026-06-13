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

  it("handles data: WITHOUT a space (proxy passthrough)", async () => {
    const lines = [
      `data:${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "proxied" } })}`,
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(lines)));
    const p = new AnthropicProvider({ apiKey: "test" } as never);
    const res = await p.chatStream([{ role: "user", content: "hi" }], {});
    expect(res.content).toBe("proxied");
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

function jsonResponse(obj: object): Response {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
}

describe("AnthropicProvider non-streaming chat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses text and tool_use blocks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      model: "claude-opus-4-8",
      stop_reason: "tool_use",
      usage: { input_tokens: 3, output_tokens: 4 },
      content: [
        { type: "text", text: "let me check" },
        { type: "tool_use", id: "toolu_9", name: "search", input: { pattern: "foo" } },
      ],
    })));
    const p = new AnthropicProvider({ apiKey: "test" } as never);
    const res = await p.chat([{ role: "user", content: "find foo" }]);
    expect(res.content).toBe("let me check");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].name).toBe("search");
    expect(JSON.parse(res.toolCalls![0].arguments)).toEqual({ pattern: "foo" });
  });

  it("does not crash on a 200 response missing the content array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ model: "m", usage: { input_tokens: 0, output_tokens: 0 } })));
    const p = new AnthropicProvider({ apiKey: "test" } as never);
    const res = await p.chat([{ role: "user", content: "hi" }]);
    expect(res.content).toBe("");
    expect(res.toolCalls).toBeUndefined();
  });
});
