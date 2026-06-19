import { describe, it, expect, beforeEach } from "vitest";
import { createLspTool, reloadLspConfig } from "../src/tools/lsp.js";

describe("lsp tool — graceful degradation (no config)", () => {
  beforeEach(() => reloadLspConfig());

  it("returns a 'not configured' message for an unsupported language", async () => {
    const tool = createLspTool();
    const res = await tool.execute({ action: "definition", file: "README.xyz", line: 1, col: 1 });
    expect(res.success).toBe(true);
    expect(res.output).toContain("not configured");
    expect(res.output).toContain("Supported extensions");
  });

  it("returns a 'not configured' message for a supported language with no server", async () => {
    const tool = createLspTool();
    const res = await tool.execute({ action: "definition", file: "src/foo.ts", line: 1, col: 1 });
    expect(res.success).toBe(true);
    expect(res.output).toContain("typescript");
    expect(res.output).toContain("not configured");
    expect(res.output).toContain('Configure under');
  });

  it("rejects an unknown action", async () => {
    const tool = createLspTool();
    const res = await tool.execute({ action: "hover", file: "src/foo.ts" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("Unknown action");
  });

  it("requires a file", async () => {
    const tool = createLspTool();
    const res = await tool.execute({ action: "definition", file: "" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("requires a 'file'");
  });
});
