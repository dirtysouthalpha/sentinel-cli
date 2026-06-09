import { describe, it, expect } from "vitest";
import { createHookAwareExecutor, HooksConfig } from "../src/core/hooks.js";
import { ChatMessage, ToolCall } from "../src/ai/types.js";

interface ShellCall {
  cmd: string;
  env: Record<string, string>;
}

/** A fake shell runner that records every invocation. */
function fakeRunner() {
  const calls: ShellCall[] = [];
  const runShell = async (cmd: string, env: Record<string, string>) => {
    calls.push({ cmd, env });
  };
  return { calls, runShell };
}

const base = async (tc: ToolCall): Promise<ChatMessage> => ({
  role: "tool",
  content: "base-" + tc.name,
  toolCallId: tc.id,
  name: tc.name,
});

const tc = (name: string, args = "{}"): ToolCall => ({ id: "1", name, arguments: args });

describe("hook-aware executor", () => {
  it("fires pre and post hooks for a matching tool, then returns the base result", async () => {
    const { calls, runShell } = fakeRunner();
    const hooks: HooksConfig = {
      preToolUse: [{ command: "echo pre" }],
      postToolUse: [{ command: "echo post" }],
    };
    const exec = createHookAwareExecutor(hooks, base, runShell);
    const msg = await exec(tc("bash"));

    expect(calls.map((c) => c.cmd)).toEqual(["echo pre", "echo post"]);
    expect(msg.content).toBe("base-bash");
    expect(msg.role).toBe("tool");
  });

  it("runs pre before base and post after base (ordering)", async () => {
    const order: string[] = [];
    const runShell = async (cmd: string) => {
      order.push(cmd);
    };
    const tracked = async (t: ToolCall): Promise<ChatMessage> => {
      order.push("base");
      return { role: "tool", content: "ok", toolCallId: t.id, name: t.name };
    };
    const hooks: HooksConfig = {
      preToolUse: [{ command: "pre" }],
      postToolUse: [{ command: "post" }],
    };
    await createHookAwareExecutor(hooks, tracked, runShell)(tc("bash"));
    expect(order).toEqual(["pre", "base", "post"]);
  });

  it("only runs hooks whose match filter applies to the tool name", async () => {
    const { calls, runShell } = fakeRunner();
    const hooks: HooksConfig = {
      preToolUse: [
        { match: "bash", command: "for-bash" },
        { match: "file", command: "for-file" },
        { command: "for-all" },
      ],
    };
    const exec = createHookAwareExecutor(hooks, base, runShell);
    await exec(tc("bash"));
    expect(calls.map((c) => c.cmd)).toEqual(["for-bash", "for-all"]);
  });

  it("passes the tool name and args through env vars", async () => {
    const { calls, runShell } = fakeRunner();
    const hooks: HooksConfig = { preToolUse: [{ command: "x" }] };
    const exec = createHookAwareExecutor(hooks, base, runShell);
    await exec(tc("file", '{"path":"a.ts"}'));
    expect(calls[0].env.SENTINEL_TOOL_NAME).toBe("file");
    expect(calls[0].env.SENTINEL_TOOL_ARGS).toBe('{"path":"a.ts"}');
  });

  it("a throwing hook does not break the tool call: base still runs and result is returned", async () => {
    let baseCalled = false;
    const tracked = async (t: ToolCall): Promise<ChatMessage> => {
      baseCalled = true;
      return { role: "tool", content: "survived", toolCallId: t.id, name: t.name };
    };
    const runShell = async () => {
      throw new Error("hook blew up");
    };
    const hooks: HooksConfig = {
      preToolUse: [{ command: "boom" }],
      postToolUse: [{ command: "boom2" }],
    };
    const msg = await createHookAwareExecutor(hooks, tracked, runShell)(tc("bash"));
    expect(baseCalled).toBe(true);
    expect(msg.content).toBe("survived");
  });

  it("no configured hooks => base passthrough, no shell calls", async () => {
    const { calls, runShell } = fakeRunner();
    const exec = createHookAwareExecutor({}, base, runShell);
    const msg = await exec(tc("bash"));
    expect(calls).toHaveLength(0);
    expect(msg.content).toBe("base-bash");
  });
});
