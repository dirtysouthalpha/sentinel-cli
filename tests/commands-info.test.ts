import { describe, it, expect, vi } from "vitest";
import type { CommandHost, CostSnapshot, ContextView } from "../src/tui/commands/types.js";
import {
  handleCost,
  handleUsage,
  handleAbout,
  handleContext,
  handleCompact,
  handleClear,
  handleSetupHelp,
  handleProviders,
  handlePermissions,
  handlePlan,
} from "../src/tui/commands/info.js";

/**
 * Phase 3b test harness: a fake CommandHost captures addSystem/addError output
 * so the extracted slash-command handlers are unit-testable WITHOUT a blessed
 * screen or a TTY. This is the verification seam the app.ts god-object previously
 * lacked — the handlers now live in commands/info.ts and take only the host.
 */

function fakeHost(opts: {
  cost?: Partial<CostSnapshot>;
  context?: Partial<ContextView>;
  permissionMode?: string;
} = {}): { host: CommandHost; out: string[]; err: string[]; ctx: ContextView; perms: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctxState = {
    messages: 3,
    chars: 8000,
    compact: vi.fn(() => {
      ctxState.messages = 1;
    }),
    clear: vi.fn(),
    getMessageCount: () => ctxState.messages,
    getCharTotal: () => ctxState.chars,
    getTotalTokens: () => Math.ceil(ctxState.chars / 3.5),
  };
  let permMode = opts.permissionMode ?? "gated";
  const host: CommandHost = {
    projectRoot: "/proj",
    tabManager: {} as never,
    addSystem: (t) => void out.push(t),
    addError: (t) => void err.push(t),
    chatWithAI: async () => {},
    getCost: () => ({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      requests: 2,
      estimatedCostUSD: 0.0123,
      ...opts.cost,
    }),
    resetCost: vi.fn(),
    getContext: () => ctxState,
    markSessionDirty: vi.fn(),
    requestRender: vi.fn(),
    getPermissionMode: () => permMode,
    setPermissionMode: (m) => void (permMode = m),
  };
  return { host, out, err, ctx: ctxState, perms: [] as string[] };
}

describe("extracted info commands (Phase 3b)", () => {
  it("/cost renders the session cost breakdown", () => {
    const { host, out } = fakeHost();
    handleCost(host, []);
    expect(out[0]).toContain("Session cost:");
    expect(out[0]).toContain("Prompt:     100 tokens");
    expect(out[0]).toContain("Completion: 50 tokens");
    expect(out[0]).toContain("Total:      150 tokens");
    expect(out[0]).toContain("Requests:   2");
    expect(out[0]).toContain("$0.0123");
  });

  it("/cost works with a host that omits getCost (all zeros)", () => {
    const out: string[] = [];
    const host: CommandHost = {
      projectRoot: "/p",
      tabManager: {} as never,
      addSystem: (t) => void out.push(t),
      addError: () => {},
      chatWithAI: async () => {},
    };
    handleCost(host, []);
    expect(out[0]).toContain("0 tokens");
    expect(out[0]).toContain("$0.0000");
  });

  it("/context renders message count + token estimate", () => {
    const { host, out } = fakeHost({ context: {} });
    handleContext(host, []);
    expect(out[0]).toContain("Messages: 3");
    expect(out[0]).toContain("~2000 tokens"); // 8000 chars / 4
    expect(out[0]).toContain("Auto-compacts");
  });

  it("/compact calls context.compact and marks the session dirty", () => {
    const { host, ctx } = fakeHost();
    const spy = host.markSessionDirty as unknown as ReturnType<typeof vi.fn>;
    handleCompact(host, []);
    expect(ctx.compact).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it("/clear clears context, resets cost, requests a render", () => {
    const { host, ctx } = fakeHost();
    handleClear(host, []);
    expect(ctx.clear).toHaveBeenCalled();
    expect(host.resetCost).toHaveBeenCalled();
    expect(host.requestRender).toHaveBeenCalled();
  });

  it("/setup emits the connection help text", () => {
    const { host, out } = fakeHost();
    handleSetupHelp(host, []);
    expect(out[0]).toContain("Connect an AI provider:");
    expect(out[0]).toContain("ZAI_API_KEY");
  });

  it("/permissions with no arg shows the current mode", () => {
    const { host, out } = fakeHost({ permissionMode: "gated" });
    handlePermissions(host, []);
    expect(out[0]).toContain("Permission mode: gated");
    expect(out[0]).toContain("yolo | auto | gated | plan");
  });

  it("/permissions with a valid mode sets it", () => {
    const { host, out } = fakeHost({ permissionMode: "gated" });
    handlePermissions(host, ["yolo"]);
    expect(out[0]).toContain("Permission mode → yolo");
  });

  it("/permissions rejects an unknown mode with an error", () => {
    const { host, err } = fakeHost();
    handlePermissions(host, ["bogus"]);
    expect(err[0]).toMatch(/Unknown mode/);
  });

  it("/plan on sets plan mode; /plan off restores yolo", () => {
    const h1 = fakeHost();
    handlePlan(h1.host, []);
    expect(h1.out[0]).toContain("Plan mode on (read-only)");

    const h2 = fakeHost();
    handlePlan(h2.host, ["off"]);
    expect(h2.out[0]).toContain("Plan mode off → yolo");
  });

  it("/about emits the version banner", () => {
    const { host, out } = fakeHost();
    handleAbout(host, []);
    expect(out[0].length).toBeGreaterThan(0);
  });

  it("/usage delegates to usageTracker.render (non-empty)", () => {
    const { host, out } = fakeHost();
    handleUsage(host, []);
    expect(typeof out[0]).toBe("string");
    expect(out[0].length).toBeGreaterThan(0);
  });

  it("/providers lists configured providers (or the none-configured note)", () => {
    const { host, out } = fakeHost();
    handleProviders(host, []);
    // Either a provider list or the "none configured" note — both are valid.
    expect(out[0].length).toBeGreaterThan(0);
  });
});
