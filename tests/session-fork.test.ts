import { describe, it, expect } from "vitest";
import { forkMessages, type ForkableMessage } from "../src/core/session-fork.js";

const M = (role: ForkableMessage["role"], content: string): ForkableMessage => ({ role, content });

describe("forkMessages — branch a conversation at a turn index", () => {
  it("copies all messages up to and including the fork index", () => {
    const msgs = [M("user", "a"), M("assistant", "b"), M("user", "c"), M("assistant", "d")];
    const forked = forkMessages(msgs, 1); // fork after assistant "b"
    expect(forked).toHaveLength(2);
    expect(forked.map((m) => m.content)).toEqual(["a", "b"]);
  });
  it("preserves message structure (role, content, metadata)", () => {
    const msgs: ForkableMessage[] = [
      { role: "user", content: "x", metadata: { attachments: [{ dataUrl: "d" }] } },
    ];
    const forked = forkMessages(msgs, 0);
    expect(forked[0].metadata).toEqual({ attachments: [{ dataUrl: "d" }] });
  });
  it("returns a NEW array (doesn't mutate the original)", () => {
    const msgs = [M("user", "a"), M("assistant", "b")];
    const forked = forkMessages(msgs, 0);
    expect(forked).not.toBe(msgs);
    forked.push(M("user", "diverged"));
    expect(msgs).toHaveLength(2); // original untouched
  });
  it("deep-copies messages so edits to the fork don't leak back", () => {
    const msgs: ForkableMessage[] = [{ role: "user", content: "orig", metadata: { x: 1 } }];
    const forked = forkMessages(msgs, 0);
    forked[0].metadata!.x = 999;
    expect(msgs[0].metadata!.x).toBe(1); // original unchanged
  });
  it("clamps the fork index to the array bounds", () => {
    const msgs = [M("user", "a")];
    expect(forkMessages(msgs, -5)).toHaveLength(0);
    expect(forkMessages(msgs, 100)).toHaveLength(1);
  });
  it("returns empty array for empty input", () => {
    expect(forkMessages([], 0)).toEqual([]);
  });
  it("fork at index 0 = just the first message", () => {
    const msgs = [M("user", "a"), M("assistant", "b")];
    expect(forkMessages(msgs, 0)).toHaveLength(1);
    expect(forkMessages(msgs, 0)[0].content).toBe("a");
  });
});
