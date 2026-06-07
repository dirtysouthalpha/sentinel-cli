import { describe, it, expect, vi } from "vitest";
import { recallRelevant, DEFAULT_RECALL_TOOL } from "../src/core/brain-recall.js";
import { ChatMessage, ToolCall } from "../src/ai/types.js";

function fakeExecutor(content: string): (tc: ToolCall) => Promise<ChatMessage> {
  return async (tc) => ({ role: "tool", content, toolCallId: tc.id, name: tc.name });
}

describe("recallRelevant", () => {
  it("formats canned recall text into a memory block", async () => {
    const out = await recallRelevant(fakeExecutor("User prefers PowerShell."), "what shell?");
    expect(out).toBe(
      "\n\n--- Relevant memory (Sentinel Prime brain) ---\nUser prefers PowerShell."
    );
  });

  it("returns '' when the result starts with ERROR", async () => {
    const out = await recallRelevant(fakeExecutor("ERROR: brain server unavailable"), "x");
    expect(out).toBe("");
  });

  it("returns '' when the result is empty/whitespace", async () => {
    expect(await recallRelevant(fakeExecutor(""), "x")).toBe("");
    expect(await recallRelevant(fakeExecutor("   \n  "), "x")).toBe("");
  });

  it("builds a brain_recall ToolCall with the query JSON-stringified", async () => {
    const exec = vi.fn(fakeExecutor("memory"));
    await recallRelevant(exec, "remember my name?");
    const tc = exec.mock.calls[0][0] as ToolCall;
    expect(tc.name).toBe(DEFAULT_RECALL_TOOL);
    expect(tc.id).toBe("recall_1");
    expect(JSON.parse(tc.arguments)).toEqual({ query: "remember my name?" });
  });

  it("honors an overridden tool name via opts.toolName", async () => {
    const exec = vi.fn(fakeExecutor("memory"));
    await recallRelevant(exec, "q", { toolName: "mcp__other__recall" });
    expect((exec.mock.calls[0][0] as ToolCall).name).toBe("mcp__other__recall");
  });
});
