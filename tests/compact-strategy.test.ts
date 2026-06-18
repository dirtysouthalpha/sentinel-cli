import { describe, it, expect } from "vitest";
import {
  planCompaction,
  chunkSummaryUnits,
  unitToText,
  planIsSafe,
} from "../src/ai/compact-strategy.js";
import type { ConversationMessage } from "../src/ai/context.js";

function m(role: ConversationMessage["role"], content: string): ConversationMessage {
  return { role, content, tokenEstimate: content.length } as ConversationMessage;
}
function tool(content: string, name = "bash"): ConversationMessage {
  return { role: "tool", content, tokenEstimate: content.length, metadata: { name } } as ConversationMessage;
}

describe("planCompaction — what survives", () => {
  it("keeps the system prompt verbatim", () => {
    const msgs = [m("system", "SYS"), m("user", "u1"), m("assistant", "a1"), m("user", "u2")];
    const plan = planCompaction(msgs, 2);
    expect(plan.keepIndices).toContain(0); // system
  });

  it("keeps the last `keepRecent` messages verbatim", () => {
    const msgs = [m("system", "S"), ...Array.from({ length: 8 }, (_, i) => m(i % 2 ? "assistant" : "user", `m${i}`))];
    const plan = planCompaction(msgs, 3);
    // last 3 indices kept
    const last3 = [msgs.length - 3, msgs.length - 2, msgs.length - 1];
    for (const i of last3) expect(plan.keepIndices).toContain(i);
  });

  it("summarizes the middle as cohesive units", () => {
    const msgs = [
      m("system", "S"),
      m("user", "u1"), m("assistant", "a1"),
      m("user", "u2"), m("assistant", "a2"), tool("r2"),
      m("user", "u3"), // this is the last message -> kept (keepRecent=1 fails the below; use 0 window)
    ];
    // Force everything but system into archival via keepRecent=0 won't keep recent;
    // use keepRecent=1 so only u3 is kept, u1..r2 get summarized.
    const plan = planCompaction(msgs, 1);
    expect(plan.summarizeUnits.length).toBe(2); // [u1,a1] and [u2,a2,r2]
    expect(plan.summarizeUnits[0].messages.map((x) => x.role)).toEqual(["user", "assistant"]);
    expect(plan.summarizeUnits[1].messages.map((x) => x.role)).toEqual(["user", "assistant", "tool"]);
  });
});

describe("planCompaction — pair-splitting invariant", () => {
  it("does NOT orphan a tool from its assistant (pair summarized together, or both kept)", () => {
    // assistant(2) + tool(3) at the boundary. With keepRecent=1, naive math keeps
    // only the trailing user(4); the assistant+tool go to archival and MUST land
    // in the SAME summary unit (so the pair is never split). planIsSafe enforces
    // the kept-side half; this asserts the archival-side half.
    const msgs = [
      m("system", "S"),
      m("user", "u1"), m("assistant", "a1"), tool("r1"),
      m("user", "u2"),
    ];
    const plan = planCompaction(msgs, 1);
    expect(planIsSafe(msgs, plan)).toBe(true);
    // The assistant+tool are summarized together in one unit (not split).
    const pairUnit = plan.summarizeUnits.find((u) => u.messages.some((x) => x.role === "tool"));
    expect(pairUnit).toBeTruthy();
    expect(pairUnit!.messages.map((x) => x.role)).toContain("assistant");
    // No tool message is kept without its assistant.
    const keptIdx = plan.keepIndices;
    for (const idx of keptIdx) {
      if (msgs[idx].role === "tool") {
        expect(keptIdx).toContain(idx - 1); // its assistant is also kept
      }
    }
  });

  it("planIsSafe flags an intentionally-broken plan (tool kept, assistant summarized)", () => {
    const msgs = [m("system", "S"), m("assistant", "a"), tool("r"), m("user", "u")];
    // keep system + tool + user, but NOT the assistant that owns the tool -> unsafe.
    const broken = { keepIndices: [0, 2, 3], summarizeUnits: [{ indices: [1], messages: [msgs[1]] }] };
    expect(planIsSafe(msgs, broken)).toBe(false);
  });
});

describe("chunkSummaryUnits", () => {
  it("each unit starts at a user turn; tools never start a unit", () => {
    const archival = [m("user", "u1"), m("assistant", "a1"), tool("r1"), m("user", "u2"), m("assistant", "a2")];
    const units = chunkSummaryUnits(archival, 0);
    expect(units.length).toBe(2);
    for (const u of units) expect(u.messages[0].role).not.toBe("tool");
  });
});

describe("unitToText", () => {
  it("tags each message with role + tool name", () => {
    const text = unitToText({ indices: [0], messages: [m("user", "hello"), tool("output", "bash")] });
    expect(text).toContain("[user] hello");
    expect(text).toContain("[tool(bash)] output");
  });
});

describe("planCompaction — degenerate cases", () => {
  it("empty conversation -> empty plan", () => {
    expect(planCompaction([], 6)).toEqual({ keepIndices: [], summarizeUnits: [] });
  });
  it("short conversation (under keepRecent) -> keep all, nothing summarized", () => {
    const msgs = [m("system", "S"), m("user", "u1")];
    const plan = planCompaction(msgs, 6);
    expect(plan.summarizeUnits.length).toBe(0);
    expect(plan.keepIndices).toEqual([0, 1]);
  });
});
