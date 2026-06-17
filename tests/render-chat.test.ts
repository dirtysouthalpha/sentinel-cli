import { describe, it, expect } from "vitest";
import { composeChatBody, ChatBodyMemo, ChatRenderInput } from "../src/tui/render-chat.js";

/**
 * Phase 3c: the chat-body composition + change-detection is pure, so it's
 * testable without blessed. The optimization it enables: flushRender skips the
 * expensive box.setContent re-tokenize when the composed body is unchanged.
 */
const card = (raw: string) => `[CARD:${raw}]`;

function input(transcript: string, streamRaw: string, streaming: boolean): ChatRenderInput {
  return { transcript, streamRaw, streaming, renderAssistantCard: card };
}

describe("composeChatBody", () => {
  it("is just the transcript when not streaming", () => {
    expect(composeChatBody(input("hello", "", false))).toBe("hello");
  });

  it("appends a live assistant card tail while streaming", () => {
    expect(composeChatBody(input("hello", "wor", true))).toBe("hello\n[CARD:wor]\n");
  });

  it("omits the tail when streaming but streamRaw is empty (still produces a card)", () => {
    // streaming=true with empty raw still renders a (possibly empty) card.
    expect(composeChatBody(input("hello", "", true))).toBe("hello\n[CARD:]\n");
  });
});

describe("ChatBodyMemo", () => {
  it("reports changed=true for the first body", () => {
    const m = new ChatBodyMemo();
    expect(m.changed("a")).toBe(true);
  });

  it("reports changed=false when the same body is presented again", () => {
    const m = new ChatBodyMemo();
    m.changed("a");
    expect(m.changed("a")).toBe(false);
  });

  it("reports changed=true when the body differs (a new token arrived)", () => {
    const m = new ChatBodyMemo();
    m.changed("hello\n[CARD:wo]\n");
    expect(m.changed("hello\n[CARD:wor]\n")).toBe(true);
  });

  it("reset() forces the next changed() to be true", () => {
    const m = new ChatBodyMemo();
    m.changed("a");
    expect(m.changed("a")).toBe(false);
    m.reset();
    expect(m.changed("a")).toBe(true);
  });

  it("simulates a streaming burst: only genuinely-new tokens repaint", () => {
    const m = new ChatBodyMemo();
    const bodies = [
      composeChatBody(input("hi", "H", true)),
      composeChatBody(input("hi", "He", true)),
      composeChatBody(input("hi", "He", true)), // duplicate (no new token)
      composeChatBody(input("hi", "Hel", true)),
    ];
    const repaints = bodies.map((b) => m.changed(b));
    expect(repaints).toEqual([true, true, false, true]);
  });
});
