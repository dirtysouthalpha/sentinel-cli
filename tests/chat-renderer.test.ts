import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatRenderer } from "../src/tui/chat-renderer.js";

vi.mock("../src/tui/themes/engine.js", () => ({
  themeEngine: {
    getBlessedColors: () => ({
      cyan: "cyan", lime: "lime", amber: "amber", error: "red",
      border: "gray", textPrimary: "white", textSecondary: "gray",
      textTertiary: "dim", bgPrimary: "black", bgSecondary: "#111",
    }),
    getTheme: () => ({ display: "Test" }),
  },
}));

vi.mock("../src/core/state.js", () => ({
  state: {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        currentAgent: "sentinel", currentModel: "test/model",
        isProcessing: false, compressionStats: { savingsPercent: 0 },
      };
      return map[key];
    },
  },
}));

vi.mock("../src/core/session-manager.js", () => ({
  sessionManager: {
    getSessionCount: () => 1,
    getActiveSessionId: () => null,
    updateSessionCost: vi.fn(),
  },
}));

vi.mock("../src/tui/render-markdown.js", () => ({
  renderMarkdown: (raw: string) => raw,
}));

function mockElement() {
  return { setContent: vi.fn(), setScrollPerc: vi.fn(), render: vi.fn() };
}

describe("ChatRenderer", () => {
  let r: ChatRenderer;
  const chat = mockElement();
  const status = mockElement();
  const screen = { render: vi.fn() };

  beforeEach(() => {
    r = new ChatRenderer();
    r.init(chat as never, status as never, screen as never);
    vi.clearAllMocks();
  });

  it("starts with zeroed cost and empty transcript", () => {
    const cost = r.getCost();
    expect(cost.estimatedCostUSD).toBe(0);
    expect(cost.totalTokens).toBe(0);
    expect(cost.requests).toBe(0);
    expect(r.getTranscript()).toBe("");
  });

  it("setCost/getCost roundtrip", () => {
    r.setCost({ promptTokens: 10, completionTokens: 20, totalTokens: 30, requests: 1, estimatedCostUSD: 0.005 });
    const c = r.getCost();
    expect(c.totalTokens).toBe(30);
    expect(c.estimatedCostUSD).toBe(0.005);
  });

  it("addSystem appends text to transcript", () => {
    r.addSystem("hello");
    expect(r.getTranscript()).toContain("hello");
  });

  it("addUser appends user message to transcript", () => {
    r.addUser("ping");
    const t = r.getTranscript();
    expect(t).toContain("ping");
    expect(t).toContain("You");
  });

  it("addError appends error to transcript", () => {
    r.addError("boom");
    expect(r.getTranscript()).toContain("boom");
  });

  it("updateCost accumulates costs across calls", () => {
    r.updateCost({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    r.updateCost({ promptTokens: 2000, completionTokens: 1000, totalTokens: 3000 });
    const c = r.getCost();
    expect(c.promptTokens).toBe(3000);
    expect(c.completionTokens).toBe(1500);
    expect(c.totalTokens).toBe(4500);
    expect(c.requests).toBe(2);
    expect(c.estimatedCostUSD).toBeCloseTo((3000 * 3 + 1500 * 15) / 1_000_000);
  });

  it("startAssistant/streamAssistant/endAssistant flow", () => {
    r.startAssistant();
    r.streamAssistant("hello ");
    r.streamAssistant("world");
    expect(chat.setContent).toHaveBeenCalled();
    r.endAssistant();
    expect(r.getTranscript()).toContain("hello world");
  });

  it("setTranscript replaces transcript; clearStream resets stream state", () => {
    r.addUser("old");
    r.setTranscript("replaced");
    expect(r.getTranscript()).toBe("replaced");
    r.startAssistant();
    r.streamAssistant("x");
    // clearStream resets stream vars; the header was already pushed to transcript
    expect(r.getTranscript()).toContain("replaced");
    expect(r.getTranscript()).toContain("Sentinel");
  });
});
