import { describe, it, expect } from "vitest";
import { compressToolOutput } from "../src/ai/compression.js";

describe("compressToolOutput", () => {
  it("returns file output verbatim regardless of size", async () => {
    const big = "const x = 1;\n".repeat(5000); // well over the threshold
    expect(await compressToolOutput(big, "file")).toBe(big);
  });

  it("returns small non-file output verbatim (no lossy slicing)", async () => {
    const out = "line1\nline2\nimportant detail at the end";
    expect(await compressToolOutput(out, "bash")).toBe(out);
  });

  it("preserves exact content for a typical search result", async () => {
    const out = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts:${i}: match`).join("\n");
    expect(await compressToolOutput(out, "search")).toBe(out);
  });
});
