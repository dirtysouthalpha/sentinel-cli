import { describe, it, expect } from "vitest";
import { buildVisionMessage } from "../src/core/vision.js";
import { loadAttachment } from "../src/core/attachments.js";
import { buildRequestBody } from "../src/ai/providers/openai-compat.js";
import type { ChatMessage, ContentPart } from "../src/ai/types.js";

const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic

describe("buildVisionMessage", () => {
  it("produces a multimodal user message: text part + image parts", () => {
    const att = loadAttachment("pic.png", { read: () => fakePng });
    const msg = buildVisionMessage("What is this?", [att]);

    expect(msg.role).toBe("user");
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as ContentPart[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "What is this?" });
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: att.dataUrl },
    });
  });

  it("works with multiple attachments and no images", () => {
    const att = loadAttachment("a.png", { read: () => fakePng });
    const multi = buildVisionMessage("two", [att, att]);
    expect((multi.content as ContentPart[]).length).toBe(3); // 1 text + 2 images

    const none = buildVisionMessage("just text", []);
    expect(none.content as ContentPart[]).toEqual([
      { type: "text", text: "just text" },
    ]);
  });
});

describe("buildRequestBody multimodal passthrough", () => {
  it("passes array (multimodal) content through unchanged", () => {
    const att = loadAttachment("pic.png", { read: () => fakePng });
    const visionMsg = buildVisionMessage("describe", [att]);

    const body = buildRequestBody([visionMsg], { model: "m" }, "default", false);
    const messages = body.messages as Array<{ role: string; content: unknown }>;

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    // Array content is forwarded verbatim (OpenAI multimodal shape).
    expect(messages[0].content).toEqual(visionMsg.content);
    expect(Array.isArray(messages[0].content)).toBe(true);
  });

  it("still handles plain string content exactly as before", () => {
    const msg: ChatMessage = { role: "user", content: "hello" };
    const body = buildRequestBody([msg], undefined, "default-model", false);
    const messages = body.messages as Array<{ role: string; content: unknown }>;

    expect(body.model).toBe("default-model");
    expect(messages[0]).toEqual({ role: "user", content: "hello" });
  });

  it("prepends a string systemPrompt without disturbing multimodal content", () => {
    const att = loadAttachment("pic.png", { read: () => fakePng });
    const visionMsg = buildVisionMessage("hi", [att]);
    const body = buildRequestBody(
      [visionMsg],
      { model: "m", systemPrompt: "be terse" },
      "default",
      false
    );
    const messages = body.messages as Array<{ role: string; content: unknown }>;

    expect(messages[0]).toEqual({ role: "system", content: "be terse" });
    expect(messages[1].content).toEqual(visionMsg.content);
  });
});
