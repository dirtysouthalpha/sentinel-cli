import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyFilter } from "../src/core/fuzzy.js";

describe("fuzzyMatch", () => {
  it("matches subsequences case-insensitively and reports indices", () => {
    const r = fuzzyMatch("ag", "agent");
    expect(r).not.toBeNull();
    expect(r!.indices).toEqual([0, 1]);
  });

  it("returns null when not a subsequence", () => {
    expect(fuzzyMatch("xyz", "agent")).toBeNull();
    expect(fuzzyMatch("tnega", "agent")).toBeNull();
  });

  it("empty query matches with zero score", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("scores consecutive + boundary matches higher than scattered ones", () => {
    const consecutive = fuzzyMatch("plan", "plan-mode")!;
    const scattered = fuzzyMatch("plan", "pelican")!; // p-l-a-n scattered
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it("rewards camelCase / word-boundary starts", () => {
    const boundary = fuzzyMatch("cm", "commandModel")!; // c + M (hump)
    const inWord = fuzzyMatch("cm", "accme")!;
    expect(boundary.score).toBeGreaterThan(inWord.score);
  });
});

describe("fuzzyFilter", () => {
  it("filters and ranks by score, best first", () => {
    const items = ["/plan", "/permissions", "/pipeline", "/clear"];
    const ranked = fuzzyFilter("pl", items);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].item).toBe("/plan"); // tightest match ranks first
    expect(ranked.every((r) => typeof r.score === "number")).toBe(true);
  });

  it("supports a key accessor for objects", () => {
    const cmds = [{ name: "export" }, { name: "explain" }];
    const ranked = fuzzyFilter("exp", cmds, (c) => c.name);
    expect(ranked.map((r) => r.item.name)).toContain("export");
  });
});
