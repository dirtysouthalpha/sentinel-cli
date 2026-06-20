import { describe, it, expect } from "vitest";
import { sessionToMarkdown } from "../src/core/session-export.js";

describe("sessionToMarkdown — pure transcript formatter", () => {
  it("formats user + assistant messages", () => {
    const out = sessionToMarkdown([
      { role: "user", content: "fix the bug" },
      { role: "assistant", content: "I fixed it." },
    ]);
    expect(out).toContain("## User");
    expect(out).toContain("fix the bug");
    expect(out).toContain("## Assistant");
    expect(out).toContain("I fixed it.");
  });
  it("includes tool results", () => {
    const out = sessionToMarkdown([
      { role: "user", content: "read the file" },
      { role: "assistant", content: "" },
      { role: "tool", content: '{"output":"file contents"}' },
    ]);
    expect(out).toContain("Tool");
    expect(out).toContain("file contents");
  });
  it("handles empty messages", () => {
    expect(sessionToMarkdown([])).toContain("# Sentinel Session");
  });
  it("includes a header", () => {
    const out = sessionToMarkdown([{ role: "user", content: "hi" }]);
    expect(out).toContain("# Sentinel Session");
  });
});
