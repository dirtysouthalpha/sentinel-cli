import { describe, it, expect } from "vitest";
import { ContextManager } from "../src/ai/context.js";

describe("ContextManager token accounting", () => {
  it("counts the system prompt in the token total", () => {
    const cm = new ContextManager("t1");
    const before = cm.getTotalTokens();
    expect(before).toBe(0);

    cm.setSystemPrompt("x".repeat(3500)); // ~1000 tokens at chars/3.5
    const afterSys = cm.getTotalTokens();
    expect(afterSys).toBeGreaterThan(900);

    cm.addMessage("user", "y".repeat(350)); // ~100 more tokens
    expect(cm.getTotalTokens()).toBeGreaterThan(afterSys);
  });

  it("reflects the system prompt in context utilization", () => {
    const cm = new ContextManager("t2");
    expect(cm.getContextUtilization()).toBe(0);
    cm.setSystemPrompt("z".repeat(35000)); // ~10k tokens
    expect(cm.getContextUtilization()).toBeGreaterThan(0);
  });

  it("compactWithLLM summarizes older messages via the provided summarizer", async () => {
    const cm = new ContextManager("llm");
    for (let i = 0; i < 12; i++) cm.addMessage("user", `message number ${i}`);
    const before = cm.getMessageCount();

    await cm.compactWithLLM(async (texts) => `SUMMARY(${texts.length})`);

    const msgs = cm.getMessages();
    expect(cm.getMessageCount()).toBeLessThan(before);
    expect(msgs.some((m) => m.content.includes("SUMMARY"))).toBe(true);
    // The 6 most recent messages are preserved verbatim.
    expect(msgs.some((m) => m.content === "message number 11")).toBe(true);
  });

  it("compactWithLLM falls back gracefully if the summarizer throws", async () => {
    const cm = new ContextManager("llm2");
    for (let i = 0; i < 12; i++) cm.addMessage("user", `m${i}`);
    await cm.compactWithLLM(async () => { throw new Error("model down"); });
    // Fell back to the char-slice compact() — still reduced, still has recent.
    expect(cm.getMessageCount()).toBeLessThan(12);
    expect(cm.getMessages().some((m) => m.content === "m11")).toBe(true);
  });

  it("compacts when many messages exceed the token budget", () => {
    const cm = new ContextManager("t3");
    // Each message ~ a lot of chars; push enough to cross the 120k-token budget.
    for (let i = 0; i < 60; i++) {
      cm.addMessage("user", "w".repeat(8000)); // ~2286 tokens each
    }
    // After auto-compaction the message count collapses well below what was added.
    expect(cm.getMessageCount()).toBeLessThan(60);
  });

  it("auto-compaction via addMessage fires the onCompact event", () => {
    const cm = new ContextManager("obs");
    cm.setMaxTokens(4000); // small budget so a handful of big messages overflow
    const events: ("heuristic" | "llm")[] = [];
    cm.onCompact((method) => events.push(method));

    for (let i = 0; i < 20; i++) {
      cm.addMessage("user", "z".repeat(3000)); // ~857 tokens each
    }

    // The overflow triggered the heuristic safety net, and it was observable.
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((m) => m === "heuristic")).toBe(true);
    expect(cm.getMessageCount()).toBeLessThan(20);
  });

  it("onCompact is unsubscribed by its returned teardown", () => {
    const cm = new ContextManager("unsub");
    cm.setMaxTokens(3000);
    const seen: ("heuristic" | "llm")[] = [];
    const off = cm.onCompact((m) => seen.push(m));

    for (let i = 0; i < 20; i++) cm.addMessage("user", "x".repeat(3000));
    const before = seen.length;
    off();
    for (let i = 0; i < 20; i++) cm.addMessage("user", "y".repeat(3000));

    expect(before).toBeGreaterThan(0);
    expect(seen.length).toBe(before); // no further events after teardown
  });

  it("compact() returns false (no-op) when there is nothing to compact", () => {
    const cm = new ContextManager("noop");
    for (let i = 0; i < 6; i++) cm.addMessage("user", "hi"); // exactly the keep-recent count
    expect(cm.compact()).toBe(false);

    cm.addMessage("user", "seventh");
    expect(cm.compact()).toBe(true);
  });
});
