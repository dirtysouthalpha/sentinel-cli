import { describe, it, expect, vi } from "vitest";
import { ToolResultCache, type CacheKey, shouldCache } from "../src/core/tool-cache.js";

describe("shouldCache — which tool calls are cacheable", () => {
  it("caches file reads", () => {
    expect(shouldCache("file", { action: "read", path: "src/foo.ts" })).toBe(true);
  });
  it("does NOT cache file writes/edits (side effects)", () => {
    expect(shouldCache("file", { action: "write", path: "x.ts" })).toBe(false);
    expect(shouldCache("file", { action: "edit", path: "x.ts" })).toBe(false);
  });
  it("caches search", () => {
    expect(shouldCache("search", { pattern: "foo" })).toBe(true);
  });
  it("caches web fetches", () => {
    expect(shouldCache("web", { url: "https://example.com" })).toBe(true);
  });
  it("does NOT cache bash (non-deterministic)", () => {
    expect(shouldCache("bash", { command: "ls" })).toBe(false);
  });
  it("does NOT cache mutations (git, patch, memory, pr)", () => {
    expect(shouldCache("git", { command: "commit" })).toBe(false);
    expect(shouldCache("memory", { action: "store" })).toBe(false);
    expect(shouldCache("pr", { action: "create" })).toBe(false);
  });
});

describe("ToolResultCache — get/set with mtime invalidation", () => {
  it("returns cached result for a repeat read (same key + unchanged mtime)", () => {
    const cache = new ToolResultCache();
    const key: CacheKey = { tool: "file", args: '{"action":"read","path":"x.ts"}' };
    cache.set(key, "file contents", 1000);
    const hit = cache.get(key, 1000); // same mtime
    expect(hit).toBe("file contents");
  });
  it("invalidates when the file mtime changes", () => {
    const cache = new ToolResultCache();
    const key: CacheKey = { tool: "file", args: '{"action":"read","path":"x.ts"}' };
    cache.set(key, "old contents", 1000);
    const hit = cache.get(key, 2000); // mtime advanced → stale
    expect(hit).toBeNull();
  });
  it("returns null for a cache miss", () => {
    const cache = new ToolResultCache();
    expect(cache.get({ tool: "file", args: "miss" }, 0)).toBeNull();
  });
  it("search results have no mtime (always cached within TTL)", () => {
    const cache = new ToolResultCache();
    const key: CacheKey = { tool: "search", args: '{"pattern":"foo"}' };
    cache.set(key, "match at line 5"); // no mtime for search
    expect(cache.get(key)).toBe("match at line 5");
  });
  it("clear() wipes everything", () => {
    const cache = new ToolResultCache();
    cache.set({ tool: "file", args: "a" }, "x", 1);
    cache.clear();
    expect(cache.get({ tool: "file", args: "a" }, 1)).toBeNull();
  });
  it("respects the TTL (entries expire)", () => {
    const now = Date.now();
    const cache = new ToolResultCache({ ttlMs: 50 });
    const key: CacheKey = { tool: "search", args: "q" };
    cache.set(key, "result");
    expect(cache.get(key)).toBe("result"); // fresh
    // Advance time past TTL
    vi.useFakeTimers(); vi.setSystemTime(now + 100);
    expect(cache.get(key)).toBeNull(); // expired
    vi.useRealTimers();
  });
});
