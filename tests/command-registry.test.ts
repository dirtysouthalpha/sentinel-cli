import { describe, it, expect, vi } from "vitest";
import {
  resolveCommand,
  dispatchCommand,
  BUILTIN_COMMANDS,
} from "../src/tui/commands/registry.js";
import type { CommandContext } from "../src/tui/commands/context.js";

/** A CommandContext whose every method is a spy, with sane defaults. */
function mockCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    projectRoot: "/tmp/proj",
    args: [],
    commandName: "",
    addSystem: vi.fn(),
    addError: vi.fn(),
    push: vi.fn(),
    chatWithAI: vi.fn(async () => {}),
    getContextManager: vi.fn(),
    getCost: vi.fn(() => ({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requests: 0,
      estimatedCostUSD: 0,
    })),
    getPermissionMode: vi.fn(() => "yolo"),
    setPermissionMode: vi.fn(),
    getRepoIndex: vi.fn(() => undefined),
    setRepoIndex: vi.fn(),
    isMcpConnected: vi.fn(() => false),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcp: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    background: {} as any,
    wireBackground: vi.fn(),
    runShell: vi.fn(async () => ""),
    runPipeline: vi.fn(async () => {}),
    runGsd: vi.fn(async () => {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    slashCtx: vi.fn(() => ({}) as any),
    showSlashMenu: vi.fn(),
    clearScreen: vi.fn(),
    quit: vi.fn(),
    ...overrides,
  };
}

describe("command registry", () => {
  it("resolves canonical command names", () => {
    for (const name of ["model", "about", "theme", "search", "ship", "mcp"]) {
      expect(resolveCommand(name)?.name).toBe(name);
    }
  });

  it("resolves aliases back to the canonical spec", () => {
    expect(resolveCommand("?")?.name).toBe("help");
    expect(resolveCommand("q")?.name).toBe("quit");
    expect(resolveCommand("exit")?.name).toBe("quit");
    expect(resolveCommand("perms")?.name).toBe("permissions");
    expect(resolveCommand("diag")?.name).toBe("diagnostics");
    expect(resolveCommand("ws")?.name).toBe("workspace");
    expect(resolveCommand("market")?.name).toBe("marketplace");
    expect(resolveCommand("p")?.name).toBe("palette");
  });

  it("returns undefined for an unknown command", () => {
    expect(resolveCommand("definitely-not-a-command")).toBeUndefined();
  });

  it("dispatchCommand returns false and runs nothing for an unknown command", async () => {
    const ctx = mockCtx();
    const handled = await dispatchCommand("definitely-not-a-command", ctx);
    expect(handled).toBe(false);
    expect(ctx.addSystem).not.toHaveBeenCalled();
    expect(ctx.addError).not.toHaveBeenCalled();
  });

  it("dispatchCommand runs the matched handler and returns true", async () => {
    const ctx = mockCtx();
    const handled = await dispatchCommand("clear", ctx);
    expect(handled).toBe(true);
    expect(ctx.clearScreen).toHaveBeenCalledOnce();
    expect(ctx.addSystem).toHaveBeenCalledWith("Cleared.");
  });

  it("dispatches an alias to the same handler as its canonical name", async () => {
    // /perms gated  ==  /permissions gated
    const ctx = mockCtx({ args: ["gated"] });
    const handled = await dispatchCommand("perms", ctx);
    expect(handled).toBe(true);
    expect(ctx.setPermissionMode).toHaveBeenCalledWith("gated");
  });

  it("passes ctx.args through to the handler", async () => {
    // /model zai/glm-4.6 should switch, not just report the current model.
    const ctx = mockCtx({ args: ["zai/glm-4.6"] });
    await dispatchCommand("model", ctx);
    expect(ctx.addSystem).toHaveBeenCalledWith("Model → zai/glm-4.6");
  });

  it("has no duplicate names or aliases across the whole registry", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const spec of BUILTIN_COMMANDS) {
      for (const key of [spec.name, ...(spec.aliases ?? [])]) {
        if (seen.has(key)) collisions.push(`${key} (in ${seen.get(key)} and ${spec.name})`);
        seen.set(key, spec.name);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("every spec has a non-empty name and a callable handler", () => {
    for (const spec of BUILTIN_COMMANDS) {
      expect(spec.name).toBeTruthy();
      expect(typeof spec.run).toBe("function");
    }
  });
});
