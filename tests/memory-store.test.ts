import { describe, it, expect } from "vitest";
import {
  MemoryStore,
  type MemoryEntry,
  addEntryPure,
  queryPure,
  capEntries,
} from "../src/core/memory-store.js";

let entryCounter = 0;
const ENTRY = (topic: string, content: string, region: MemoryEntry["region"] = "knowledge"): MemoryEntry => ({
  id: `mem_${entryCounter}_${Math.random().toString(36).slice(2, 6)}`,
  topic,
  content,
  region,
  source: "test",
  createdAt: entryCounter++, // incrementing so recency ranking is deterministic
});

describe("addEntryPure — append to a memory log", () => {
  it("appends an entry to an empty log", () => {
    const e = ENTRY("auth", "use OAuth not API keys");
    const log = addEntryPure([], e);
    expect(log).toHaveLength(1);
    expect(log[0].content).toBe("use OAuth not API keys");
  });
  it("appends to the end of an existing log", () => {
    const e1 = ENTRY("a", "first");
    const e2 = ENTRY("b", "second");
    const log = addEntryPure([e1], e2);
    expect(log.map((e) => e.content)).toEqual(["first", "second"]);
  });
});

describe("capEntries — bound the memory size", () => {
  it("keeps the most recent N entries (drops oldest)", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ENTRY(`t${i}`, `c${i}`));
    const capped = capEntries(entries, 5);
    expect(capped).toHaveLength(5);
    expect(capped[0].content).toBe("c5"); // oldest 5 dropped
    expect(capped[4].content).toBe("c9");
  });
  it("returns unchanged when under the cap", () => {
    const entries = [ENTRY("a", "x")];
    expect(capEntries(entries, 100)).toHaveLength(1);
  });
});

describe("queryPure — search the memory log", () => {
  const log: MemoryEntry[] = [
    ENTRY("auth", "use OAuth for GitHub", "decision"),
    ENTRY("testing", "always write tests first", "preference"),
    ENTRY("auth", "token rotation every 24h", "knowledge"),
  ];
  it("matches by topic substring", () => {
    const results = queryPure(log, "auth");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.topic.includes("auth"))).toBe(true);
  });
  it("matches by content substring", () => {
    const results = queryPure(log, "tests");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("tests");
  });
  it("matches by region", () => {
    const results = queryPure(log, "", "decision");
    expect(results).toHaveLength(1);
    expect(results[0].region).toBe("decision");
  });
  it("returns empty for no match", () => {
    expect(queryPure(log, "nonexistent")).toEqual([]);
  });
  it("ranks by recency (newest first) when matches are equal", () => {
    const results = queryPure(log, "auth");
    // Both auth entries match; the one added later (token rotation) should rank first.
    expect(results[0].content).toBe("token rotation every 24h");
  });
});

describe("MemoryStore — file-backed CRUD over an injected reader/writer", () => {
  it("store + recall round-trips through an in-memory backend", () => {
    let file: string | null = null;
    const store = new MemoryStore({
      read: () => (file ? JSON.parse(file) : []),
      write: (data) => { file = JSON.stringify(data); },
    });
    store.add("auth", "use OAuth", "decision");
    store.add("testing", "write tests first", "preference");
    const results = store.query("auth");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("use OAuth");
  });
  it("survives a fresh instance (persistence)", () => {
    let file = JSON.stringify([
      ENTRY("decisions", "ship v2.4 today", "decision"),
    ]);
    const store = new MemoryStore({
      read: () => (file ? JSON.parse(file) : []),
      write: (data) => { file = JSON.stringify(data); },
    });
    const results = store.query("ship");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("ship v2.4 today");
  });
  it("caps at the configured max entries", () => {
    let file: string | null = null;
    const store = new MemoryStore({
      read: () => (file ? JSON.parse(file) : []),
      write: (data) => { file = JSON.stringify(data); },
    }, { maxEntries: 3 });
    store.add("a", "1");
    store.add("b", "2");
    store.add("c", "3");
    store.add("d", "4"); // should evict the oldest
    const all = store.query("");
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.content)).toEqual(["4", "3", "2"]); // newest first
  });
});
