import { describe, it, expect } from "vitest";
import { extractToolCalls } from "../src/core/tool-call-extractor.js";

describe("extractToolCalls", () => {
  it("parses a ```tool JSON block", () => {
    const content = [
      "Here you go:",
      "```tool",
      JSON.stringify({ id: "abc", name: "read_file", arguments: { path: "a.ts" } }),
      "```",
    ].join("\n");

    const calls = extractToolCalls(content);
    expect(calls).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls![0].id).toBe("abc");
    expect(calls![0].name).toBe("read_file");
    expect(JSON.parse(calls![0].arguments)).toEqual({ path: "a.ts" });
  });

  it("parses a ```bash block into a bash tool call", () => {
    const content = ["Run this:", "```bash", "ls -la", "echo hi", "```"].join("\n");

    const calls = extractToolCalls(content);
    expect(calls).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls![0].name).toBe("bash");
    expect(JSON.parse(calls![0].arguments)).toEqual({ command: "ls -la\necho hi" });
  });

  it("parses multiple blocks (tool + bash)", () => {
    const content = [
      "```tool",
      JSON.stringify({ name: "search", arguments: { q: "foo" } }),
      "```",
      "and then",
      "```bash",
      "pwd",
      "```",
    ].join("\n");

    const calls = extractToolCalls(content);
    expect(calls).not.toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls!.map((c) => c.name)).toEqual(["search", "bash"]);
  });

  it("preserves a string-typed arguments field as-is", () => {
    const content = [
      "```tool",
      JSON.stringify({ name: "x", arguments: '{"already":"string"}' }),
      "```",
    ].join("\n");

    const calls = extractToolCalls(content);
    expect(calls![0].arguments).toBe('{"already":"string"}');
  });

  it("skips a malformed tool JSON block", () => {
    const content = ["```tool", "{ not valid json ]", "```"].join("\n");
    const calls = extractToolCalls(content);
    expect(calls).toBeNull();
  });

  it("skips malformed but keeps valid blocks", () => {
    const content = [
      "```tool",
      "{ broken",
      "```",
      "```bash",
      "echo ok",
      "```",
    ].join("\n");
    const calls = extractToolCalls(content);
    expect(calls).toHaveLength(1);
    expect(calls![0].name).toBe("bash");
  });

  it("returns null when there are no blocks", () => {
    expect(extractToolCalls("just some prose without fences")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(extractToolCalls("")).toBeNull();
  });
});
