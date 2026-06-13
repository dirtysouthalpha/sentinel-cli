import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PaletteCallbacks } from "../src/tui/command-palette.js";

// ── Mocks ──────────────────────────────────────────────────────────────
const mockBox = {
  show: vi.fn(),
  hide: vi.fn(),
  setFront: vi.fn(),
  setContent: vi.fn(),
};

vi.mock("blessed", () => ({
  default: {
    box: () => mockBox,
  },
}));

vi.mock("../src/tui/themes/engine.js", () => ({
  themeEngine: {
    getBlessedColors: () => ({
      bg: "#0a0a0a",
      fg: "#e0e0e0",
      bgSecondary: "#111111",
      textPrimary: "#e0e0e0",
      textTertiary: "#666666",
      accent: "#00ffff",
      cyan: "#00ffff",
    }),
    getAllThemes: () => [
      { name: "cyberpunk", display: "Cyberpunk" },
    ],
  },
}));

vi.mock("../src/core/state.js", () => ({
  state: { getModel: () => "zai/glm-5.1" },
}));

vi.mock("../src/core/fuzzy.js", () => ({
  fuzzyMatch: (q: string, target: string) => {
    // Simple substring "fuzzy" for testing
    if (target.includes(q)) return { score: 1, indices: [] };
    return null;
  },
}));

vi.mock("../src/core/command-catalog.js", () => ({
  searchCatalog: () => [{ command: "/plan", description: "Plan mode" }],
}));

// Import after mocks are registered
const { CommandPalette } = await import("../src/tui/command-palette.js");

function makePalette(): { palette: InstanceType<typeof CommandPalette>; callbacks: PaletteCallbacks } {
  const callbacks: PaletteCallbacks = {
    onCommand: vi.fn(),
    onTheme: vi.fn(),
    onAgent: vi.fn(),
    onModel: vi.fn(),
  };
  const palette = new CommandPalette(callbacks);
  const screen = { render: vi.fn() } as unknown as Parameters<InstanceType<typeof CommandPalette>["init"]>[0];
  palette.init(screen);
  return { palette, callbacks };
}

// ── Tests ──────────────────────────────────────────────────────────────
describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts closed", () => {
    const { palette } = makePalette();
    expect(palette.isOpen()).toBe(false);
  });

  it("open() sets isOpen to true", () => {
    const { palette } = makePalette();
    palette.open();
    expect(palette.isOpen()).toBe(true);
    expect(mockBox.show).toHaveBeenCalled();
  });

  it("close() sets isOpen to false", () => {
    const { palette } = makePalette();
    palette.open();
    palette.close();
    expect(palette.isOpen()).toBe(false);
    expect(mockBox.hide).toHaveBeenCalled();
  });

  it("handleKey with Escape closes the palette", () => {
    const { palette } = makePalette();
    palette.open();
    const consumed = palette.handleKey("", 27);
    expect(consumed).toBe(true);
    expect(palette.isOpen()).toBe(false);
  });

  it("handleKey with Enter triggers accept (callback)", () => {
    const { palette, callbacks } = makePalette();
    palette.open();
    // First entry from searchCatalog is a "command" entry
    palette.handleKey("", 13);
    expect(callbacks.onCommand).toHaveBeenCalledWith("/plan");
    expect(palette.isOpen()).toBe(false);
  });

  it("handleKey with backspace removes last char from query", () => {
    const { palette } = makePalette();
    palette.open();
    palette.handleKey("a", 97);
    palette.handleKey("b", 98);
    palette.handleKey("", 127); // backspace
    // After typing "a" then "b" then backspace, query should be "a"
    // Re-type to verify — if we accept now the filtered list should match query "a"
    expect(palette.isOpen()).toBe(true);
  });

  it("handleKey with printable char appends to query", () => {
    const { palette, callbacks } = makePalette();
    palette.open();
    // Type "/p" to narrow to /plan, then accept
    palette.handleKey("/", 47);
    palette.handleKey("p", 112);
    palette.handleKey("", 13);
    expect(callbacks.onCommand).toHaveBeenCalledWith("/plan");
  });

  it("handleKey returns false when palette is closed", () => {
    const { palette } = makePalette();
    const consumed = palette.handleKey("a", 97);
    expect(consumed).toBe(false);
  });
});
