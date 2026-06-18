import { describe, it, expect } from "vitest";
import { SearchSession } from "../src/tui/search.js";

describe("SearchSession (pure)", () => {
  it("finds all match offsets case-insensitively", () => {
    const s = new SearchSession();
    s.query = "foo";
    expect(s.findAll("Foo bar foo baz FOO")).toEqual([0, 8, 16]);
  });

  it("finds overlapping-safe consecutive matches", () => {
    const s = new SearchSession();
    s.query = "aa";
    expect(s.findAll("aaaa")).toEqual([0, 1, 2]);
  });

  it("empty query yields no matches", () => {
    const s = new SearchSession();
    s.query = "";
    expect(s.findAll("anything")).toEqual([]);
    expect(s.current()).toBeNull();
  });

  it("no matches leaves current null and count 0", () => {
    const s = new SearchSession();
    s.query = "zzz";
    expect(s.findAll("hello")).toEqual([]);
    expect(s.count()).toBe(0);
    expect(s.current()).toBeNull();
  });

  it("next/prev cycle through matches with wraparound", () => {
    const s = new SearchSession();
    s.query = "x";
    s.setMatches([2, 5, 9]);
    expect(s.current()).toBe(2);
    expect(s.next()).toBe(5);
    expect(s.next()).toBe(9);
    expect(s.next()).toBe(2); // wrap forward
    expect(s.prev()).toBe(9); // wrap back
    expect(s.prev()).toBe(5);
  });

  it("index tracks the current match (1-based for display)", () => {
    const s = new SearchSession();
    s.setMatches([2, 5, 9]);
    expect(s.indexOneBased()).toBe(1);
    s.next();
    expect(s.indexOneBased()).toBe(2);
  });

  it("reset clears everything", () => {
    const s = new SearchSession();
    s.query = "a";
    s.findAll("aaa");
    s.reset();
    expect(s.count()).toBe(0);
    expect(s.query).toBe("");
    expect(s.current()).toBeNull();
  });
});
