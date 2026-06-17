import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandMentions } from "../src/core/mentions.js";

describe("expandMentions", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sentinel-mentions-"));
    await writeFile(join(dir, "notes.md"), "hello from notes", "utf8");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns text unchanged when there are no mentions", async () => {
    const out = await expandMentions("just a normal message", dir);
    expect(out).toBe("just a normal message");
  });

  it("expands a relative file mention with the file contents", async () => {
    const out = await expandMentions("see @notes.md please", dir);
    expect(out).toContain("--- Referenced context ---");
    expect(out).toContain("@notes.md (file):");
    expect(out).toContain("hello from notes");
  });

  it("notes a missing file instead of throwing", async () => {
    const out = await expandMentions("look at @missing.txt", dir);
    expect(out).toContain("@missing.txt (file): [not found or unreadable]");
  });

  it("expands a URL mention via injected fetchText", async () => {
    const out = await expandMentions("check @https://example.com/doc", dir, {
      fetchText: async (url) => `fetched body for ${url}`,
    });
    expect(out).toContain("@https://example.com/doc (url):");
    expect(out).toContain("fetched body for https://example.com/doc");
  });

  it("notes a failed fetch instead of throwing", async () => {
    const out = await expandMentions("check @https://bad.example", dir, {
      fetchText: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toContain("[failed to fetch:");
    expect(out).toContain("boom");
  });

  it("truncates oversized content and flags it", async () => {
    const out = await expandMentions("big @https://example.com/big", dir, {
      maxBytes: 10,
      fetchText: async () => "x".repeat(100),
    });
    expect(out).toContain("... (truncated)");
  });

  it("deduplicates repeated mentions", async () => {
    const out = await expandMentions("@notes.md and again @notes.md", dir);
    const occurrences = out.split("@notes.md (file):").length - 1;
    expect(occurrences).toBe(1);
  });

  it("ignores email-like @ that is not whitespace-prefixed", async () => {
    const out = await expandMentions("email me at foo@bar.com", dir);
    expect(out).toBe("email me at foo@bar.com");
  });
});
