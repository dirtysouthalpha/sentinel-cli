import { describe, it, expect } from "vitest";
import { classifyTurn } from "../src/ai/classify-turn.js";
import type { ChatMessage } from "../src/ai/types.js";

const m = (role: ChatMessage["role"], content: string): ChatMessage => ({ role, content });

describe("classifyTurn — pure turn classification for the router", () => {
  it("classifies a bare user question (no tools) as 'chat' (cheap route)", () => {
    expect(classifyTurn([m("user", "What does this codebase do?")], false)).toEqual({
      taskKind: "chat",
      requiresVision: false,
    });
  });

  it("classifies a turn with tools available as 'code' (strong route)", () => {
    expect(classifyTurn([m("user", "add a health check")], true)).toEqual({
      taskKind: "code",
      requiresVision: false,
    });
  });

  it("classifies a search-heavy turn as 'search'", () => {
    expect(
      classifyTurn([m("user", "find all uses of the deprecated api")], true)
    ).toEqual({
      taskKind: "search",
      requiresVision: false,
    });
  });

  it("classifies a planning turn as 'plan'", () => {
    expect(
      classifyTurn([m("user", "plan out the architecture for the new feature")], false)
    ).toEqual({
      taskKind: "plan",
      requiresVision: false,
    });
  });

  it("detects vision when a message carries image content parts", () => {
    const visionMsg: ChatMessage = {
      role: "user",
      content: [{ type: "text", text: "what's in this image?" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }],
    };
    expect(classifyTurn([visionMsg], false)).toEqual({
      taskKind: "chat",
      requiresVision: true,
    });
  });

  it("detects vision even on a code turn (tools + image)", () => {
    const visionMsg: ChatMessage = {
      role: "user",
      content: [{ type: "text", text: "fix the layout in this screenshot" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }],
    };
    expect(classifyTurn([visionMsg], true)).toEqual({
      taskKind: "code",
      requiresVision: true,
    });
  });

  it("treats short follow-ups on a code task as 'chat' (cheap route)", () => {
    // A 2-word reply on a tool-bearing turn — cheap model can handle it.
    expect(classifyTurn([m("user", "yes please")], true)).toEqual({
      taskKind: "chat",
      requiresVision: false,
    });
  });

  it("classifies an empty input as 'chat' (safe default)", () => {
    expect(classifyTurn([], false)).toEqual({
      taskKind: "chat",
      requiresVision: false,
    });
  });

  it("keys 'fix'/'debug'/'refactor' to 'code' even without tools", () => {
    // These need the strong model regardless of whether tools are in scope this turn.
    expect(classifyTurn([m("user", "fix the flaky test")], false).taskKind).toBe("code");
    expect(classifyTurn([m("user", "debug the parser crash")], false).taskKind).toBe("code");
    expect(classifyTurn([m("user", "refactor the api layer")], false).taskKind).toBe("code");
  });

  it("content parts with text only (no image) does not trigger vision", () => {
    const textParts: ChatMessage = {
      role: "user",
      content: [{ type: "text", text: "just text here" }],
    };
    expect(classifyTurn([textParts], false).requiresVision).toBe(false);
  });
});
