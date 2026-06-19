import { describe, it, expect } from "vitest";
import { formatApprovalPrompt } from "../src/core/approval-diff.js";

describe("formatApprovalPrompt — diff shown at the permission gate", () => {
  it("formats an edit diff with file path + +/- lines", () => {
    const out = formatApprovalPrompt("line1\nline2\nline3", "line1\nCHANGED\nline3", "src/foo.ts");
    expect(out).toContain("src/foo.ts");
    expect(out).toContain("- line2");
    expect(out).toContain("+ CHANGED");
  });

  it("shows '(new file)' when there was no prior content", () => {
    const out = formatApprovalPrompt("", "new content", "src/new.ts");
    expect(out).toContain("new file");
    expect(out).toContain("+ new content");
  });

  it("shows '(no line changes)' for identical content", () => {
    const out = formatApprovalPrompt("same\ncontent", "same\ncontent", "f.ts");
    expect(out).toContain("no line changes");
  });

  it("includes a clear approve/reject prompt line", () => {
    const out = formatApprovalPrompt("a", "b", "f.ts");
    expect(out.toLowerCase()).toMatch(/approve|allow|y\/n|yes/);
  });

  it("caps long diffs to keep the prompt readable", () => {
    const prior = Array.from({ length: 100 }, (_, i) => `old${i}`).join("\n");
    const next = Array.from({ length: 100 }, (_, i) => `new${i}`).join("\n");
    const out = formatApprovalPrompt(prior, next, "big.ts");
    // Should be capped — not 200 lines.
    const lines = out.split("\n");
    expect(lines.length).toBeLessThan(60);
    expect(out).toContain("more line");
  });
});
