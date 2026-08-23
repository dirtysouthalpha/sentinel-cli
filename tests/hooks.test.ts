import { describe, it, expect } from "vitest";
import {
  createHookAwareExecutor,
  runOnStopHooks,
  runSessionHooks,
  HooksConfig,
} from "../src/core/hooks.js";
import type { ChatMessage, ToolCall } from "../src/ai/types.js";

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

describe("blocking hooks (V7 gates)", () => {
  it("a failing BLOCKING preToolUse hook denies the tool call — base never runs", async () => {
    let baseCalled = false;
    const tracked = async (t: ToolCall): Promise<ChatMessage> => {
      baseCalled = true;
      return { role: "tool", content: "should not happen", toolCallId: t.id, name: t.name };
    };
    const runShell = async () => {
      throw new Error("exit 1: tests failed");
    };
    const hooks: HooksConfig = { preToolUse: [{ command: "npm test", blocking: true }] };
    const msg = await createHookAwareExecutor(hooks, tracked, runShell)(tc("bash"));

    expect(baseCalled).toBe(false);
    expect(msg.content).toMatch(/blocked by a blocking preToolUse hook/);
    expect(msg.toolCallId).toBe("1");
  });

  it("a PASSING blocking hook lets the tool through", async () => {
    const { calls, runShell } = fakeRunner();
    const hooks: HooksConfig = { preToolUse: [{ command: "npm test", blocking: true }] };
    const msg = await createHookAwareExecutor(hooks, base, runShell)(tc("bash"));
    expect(calls).toHaveLength(1);
    expect(msg.content).toBe("base-bash");
  });

  it("a failing NON-blocking hook never denies (back-compat)", async () => {
    const runShell = async () => {
      throw new Error("exit 1");
    };
    const hooks: HooksConfig = { preToolUse: [{ command: "flaky-lint" }] };
    const msg = await createHookAwareExecutor(hooks, base, runShell)(tc("bash"));
    expect(msg.content).toBe("base-bash");
  });
});

describe("JS script hooks", () => {
  const okModule = async () => {};
  const blockModule = async () => ({ block: true, reason: "lint failed" }) as const;
  const throwModule = async () => {
    throw new Error("script hook crashed");
  };

  it("runs the module's default export and passes the payload", async () => {
    const seen: string[] = [];
    const loadModule = async () => async (payload: { event: string; toolName?: string }) => {
      seen.push(`${payload.event}:${payload.toolName}`);
    };
    const hooks: HooksConfig = { preToolUse: [{ script: "hook.mjs" }] };
    const msg = await createHookAwareExecutor(hooks, base, fakeRunner().runShell, loadModule)(tc("bash"));
    expect(seen).toEqual(["preToolUse:bash"]);
    expect(msg.content).toBe("base-bash");
  });

  it("a blocking script that returns { block: true } denies the tool", async () => {
    const loadModule = async () => blockModule;
    let baseCalled = false;
    const tracked = async (t: ToolCall): Promise<ChatMessage> => {
      baseCalled = true;
      return { role: "tool", content: "x", toolCallId: t.id, name: t.name };
    };
    const hooks: HooksConfig = { preToolUse: [{ script: "gate.mjs", blocking: true }] };
    const msg = await createHookAwareExecutor(hooks, tracked, fakeRunner().runShell, loadModule)(tc("bash"));
    expect(baseCalled).toBe(false);
    expect(msg.content).toMatch(/blocked/);
  });

  it("a throwing blocking script denies; a throwing non-blocking script does not", async () => {
    const loadModule = async () => throwModule;
    const deny = { preToolUse: [{ script: "s.mjs", blocking: true }] } as HooksConfig;
    const allow = { preToolUse: [{ script: "s.mjs" }] } as HooksConfig;
    const runShell = fakeRunner().runShell;
    expect((await createHookAwareExecutor(deny, base, runShell, loadModule)(tc("bash"))).content).toMatch(/blocked/);
    expect((await createHookAwareExecutor(allow, base, runShell, loadModule)(tc("bash"))).content).toBe("base-bash");
  });

  it("a module with no default export fails closed only when blocking", async () => {
    const loadModule = async () => {
      throw new Error("no default export");
    };
    const hooks: HooksConfig = { preToolUse: [{ script: "bad.mjs", blocking: true }] };
    const msg = await createHookAwareExecutor(hooks, base, fakeRunner().runShell, loadModule)(tc("bash"));
    expect(msg.content).toMatch(/blocked/);
    expect(okModule).toBeDefined();
  });
});

describe("onStop and session hooks", () => {
  it("onStop fires with stop reason + exit code in env; non-blocking failure returns false", async () => {
    const { calls, runShell } = fakeRunner();
    const hooks: HooksConfig = { onStop: [{ command: "notify-ci" }] };
    const blocked = await runOnStopHooks(hooks, "no_tool_calls", 0, runShell);
    expect(blocked).toBe(false);
    expect(calls[0].cmd).toBe("notify-ci");
    expect(calls[0].env.SENTINEL_STOP_REASON).toBe("no_tool_calls");
    expect(calls[0].env.SENTINEL_EXIT_CODE).toBe("0");
    expect(calls[0].env.SENTINEL_HOOK_EVENT).toBe("onStop");
  });

  it("a failing BLOCKING onStop hook reports blocked (caller escalates to exit 4)", async () => {
    const runShell = async () => {
      throw new Error("exit 1");
    };
    const hooks: HooksConfig = { onStop: [{ command: "gate", blocking: true }] };
    expect(await runOnStopHooks(hooks, "no_tool_calls", 0, runShell)).toBe(true);
  });

  it("no onStop rules => false, no shell calls", async () => {
    const { calls, runShell } = fakeRunner();
    expect(await runOnStopHooks({}, "error", 1, runShell)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("sessionStart/sessionEnd fire once each with the hook event in env; failures swallowed", async () => {
    const { calls, runShell } = fakeRunner();
    const hooks: HooksConfig = {
      sessionStart: ["bootstrap"],
      sessionEnd: ["teardown"],
    };
    await runSessionHooks(hooks, "sessionStart", { SENTINEL_PROJECT: "/p" }, runShell);
    await runSessionHooks(hooks, "sessionEnd", { SENTINEL_PROJECT: "/p", SENTINEL_EXIT_CODE: "0" }, runShell);
    expect(calls.map((c) => c.cmd)).toEqual(["bootstrap", "teardown"]);
    expect(calls[0].env.SENTINEL_HOOK_EVENT).toBe("sessionStart");
    expect(calls[1].env.SENTINEL_HOOK_EVENT).toBe("sessionEnd");
    expect(calls[1].env.SENTINEL_EXIT_CODE).toBe("0");

    const boom = async () => {
      throw new Error("nope");
    };
    await runSessionHooks(hooks, "sessionEnd", {}, boom); // must not throw
  });
});
