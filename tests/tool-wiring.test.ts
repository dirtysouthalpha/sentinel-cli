import { describe, it, expect } from "vitest";
import { getToolDefinitions } from "../src/tools/tool-executor.js";
import { toolManager } from "../src/tools/index.js";

describe("tool wiring", () => {
  it("exposes lsp to the model via getToolDefinitions", () => {
    const names = getToolDefinitions().map((d) => d.function.name);
    expect(names).toContain("lsp");
  });

  it("registers lsp in toolManager so executeToolCall can dispatch it", () => {
    toolManager.initialize(process.cwd());
    expect(toolManager.has("lsp")).toBe(true);
  });

  it("keeps every model-facing tool dispatchable (defs ⊆ registry)", () => {
    toolManager.initialize(process.cwd());
    const registered = new Set(toolManager.getNames());
    const exposed = getToolDefinitions().map((d) => d.function.name);
    for (const name of exposed) {
      expect(registered.has(name)).toBe(true);
    }
  });
});
