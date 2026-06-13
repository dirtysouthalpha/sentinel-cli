import { describe, it, expect, vi } from "vitest";
import { StuckDetector } from "../src/core/stuck-detector.js";
import type { ToolCall } from "../src/ai/types.js";

function tc(name: string, args: string): ToolCall {
  return { id: `id-${name}`, name, arguments: args };
}

describe("StuckDetector", () => {
  it("returns false with fewer calls than threshold", () => {
    const d = new StuckDetector(3);
    d.record(tc("bash", '{"cmd":"ls"}'));
    d.record(tc("bash", '{"cmd":"ls"}'));
    expect(d.isStuck()).toBe(false);
  });

  it("detects stuck when threshold reached", () => {
    const d = new StuckDetector(3);
    d.record(tc("bash", '{"cmd":"ls"}'));
    d.record(tc("bash", '{"cmd":"ls"}'));
    d.record(tc("bash", '{"cmd":"ls"}'));
    expect(d.isStuck()).toBe(true);
  });

  it("does not detect stuck with different calls", () => {
    const d = new StuckDetector(3);
    d.record(tc("bash", '{"cmd":"ls"}'));
    d.record(tc("bash", '{"cmd":"pwd"}'));
    d.record(tc("bash", '{"cmd":"ls"}'));
    expect(d.isStuck()).toBe(false);
  });

  it("detects a two-cycle oscillation (A,B,A,B)", () => {
    const d = new StuckDetector(3);
    d.record(tc("file", '{"action":"read","path":"x"}'));   // A
    d.record(tc("file", '{"action":"edit","path":"x"}'));   // B
    d.record(tc("file", '{"action":"read","path":"x"}'));   // A
    expect(d.isStuck()).toBe(false); // only 3 so far, not all identical
    d.record(tc("file", '{"action":"edit","path":"x"}'));   // B -> A,B,A,B
    expect(d.isStuck()).toBe(true);
  });

  it("does not flag genuine progress as a cycle", () => {
    const d = new StuckDetector(3);
    d.record(tc("file", '{"action":"read","path":"a"}'));
    d.record(tc("file", '{"action":"read","path":"b"}'));
    d.record(tc("file", '{"action":"read","path":"c"}'));
    d.record(tc("file", '{"action":"read","path":"d"}'));
    expect(d.isStuck()).toBe(false);
  });

  it("resets history", () => {
    const d = new StuckDetector(3);
    d.record(tc("bash", '{"cmd":"ls"}'));
    d.record(tc("bash", '{"cmd":"ls"}'));
    d.record(tc("bash", '{"cmd":"ls"}'));
    expect(d.isStuck()).toBe(true);
    d.reset();
    expect(d.isStuck()).toBe(false);
  });

  it("prunes old entries beyond 100", () => {
    const d = new StuckDetector(3);
    for (let i = 0; i < 150; i++) {
      d.record(tc("bash", `{"cmd":"${i}"}`));
    }
    expect(d.isStuck()).toBe(false);
  });
});
