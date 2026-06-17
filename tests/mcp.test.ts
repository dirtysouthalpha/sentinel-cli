import { describe, it, expect } from "vitest";
import { createMcpAwareExecutor, McpToolHost } from "../src/mcp/mcp-executor.js";
import { mcpToolName } from "../src/mcp/manager.js";

const host: McpToolHost = {
  has: (n) => n.startsWith("mcp__"),
  execute: async (n, a) => `mcp:${n}:${JSON.stringify(a)}`,
};

describe("mcpToolName", () => {
  it("namespaces server + tool", () => {
    expect(mcpToolName("everything", "add")).toBe("mcp__everything__add");
  });
});

describe("mcp-aware executor", () => {
  it("routes mcp__ tools to the host (not baseExecute)", async () => {
    let baseCalled = false;
    const exec = createMcpAwareExecutor(host, async (tc) => {
      baseCalled = true;
      return { role: "tool", content: "base", name: tc.name };
    });
    const msg = await exec({ id: "1", name: "mcp__srv__add", arguments: '{"a":1}' });
    expect(baseCalled).toBe(false);
    expect(msg.content).toBe('mcp:mcp__srv__add:{"a":1}');
    expect(msg.toolCallId).toBe("1");
    expect(msg.role).toBe("tool");
  });

  it("passes non-mcp tools through to baseExecute", async () => {
    const exec = createMcpAwareExecutor(host, async (tc) => ({
      role: "tool",
      content: "base-" + tc.name,
      name: tc.name,
    }));
    const msg = await exec({ id: "2", name: "bash", arguments: "{}" });
    expect(msg.content).toBe("base-bash");
  });

  it("tolerates malformed args", async () => {
    const exec = createMcpAwareExecutor(host, async (tc) => ({ role: "tool", content: "base", name: tc.name }));
    const msg = await exec({ id: "3", name: "mcp__srv__x", arguments: "not json" });
    expect(msg.content).toBe("mcp:mcp__srv__x:{}");
  });
});
