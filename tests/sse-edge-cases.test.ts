import { describe, it, expect } from "vitest";
import { parseOpenAIStream } from "../src/ai/providers/openai-compat.js";

/**
 * Regression tests for two SSE parsing edge cases. Ports the fixes from the
 * `agentic-hardening` lineage onto the current v3.x stream parser:
 *   1. `data:` with no space after the colon (e.g. Gemini's OpenAI-compat mode)
 *   2. a final event with no trailing newline (carries the `usage` record)
 */
function streamFrom(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body);
}

describe("parseOpenAIStream SSE edge cases", () => {
  it("accepts `data:` without a space after the colon", async () => {
    // No space after `data:` — the old parser required `data: ` and dropped these.
    const res = await parseOpenAIStream(
      streamFrom([
        'data:{"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data:{"choices":[{"delta":{"content":"lo"}}]}\n',
        "data:[DONE]\n",
      ])
    );
    expect(res.content).toBe("Hello");
  });

  it("processes a final event that has no trailing newline", async () => {
    // The usage record arrives as the last event with no closing newline;
    // the old loop left it in `buffer` and never parsed it.
    const res = await parseOpenAIStream(
      streamFrom([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}',
      ])
    );
    expect(res.content).toBe("hi");
    expect(res.usage?.totalTokens).toBe(4);
  });

  it("still handles the well-formed `data: ` case", async () => {
    const res = await parseOpenAIStream(
      streamFrom([
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
        "data: [DONE]\n",
      ])
    );
    expect(res.content).toBe("ok");
  });
});
