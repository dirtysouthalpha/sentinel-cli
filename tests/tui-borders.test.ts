import { describe, it, expect } from "vitest";
import {
  accentBorderFor,
  glowText,
  neonDivider,
  pulseDot,
  BREATHE_FRAMES,
} from "../src/tui/borders.js";
import type { BlessedColors } from "../src/tui/themes/types.js";
import type { ThemeEffects } from "../src/tui/themes/types.js";

const COLORS: BlessedColors = {
  bg: "#06080C", bgPrimary: "#06080C", bgSecondary: "#0B0F18", bgTertiary: "#111827",
  fg: "#E0E6F0", fgPrimary: "#E0E6F0", fgSecondary: "#8892A8", fgTertiary: "#4A5568",
  textPrimary: "#E0E6F0", textSecondary: "#8892A8", textTertiary: "#4A5568",
  border: "#1A2236", borderActive: "#00D4FF",
  accent: "#00D4FF", accentHover: "#00A8CC", success: "#00FF88", warning: "#FFB800",
  error: "#FF2E63", info: "#00D4FF", cyan: "#00D4FF", lime: "#39FF14", amber: "#FFB800",
  magenta: "#FF2E63", purple: "#8B5CF6",
};

const GLOW: ThemeEffects = { glow: true, pulse: true, scanlines: true, grid: true };
const NONE: ThemeEffects = {};

describe("accentBorderFor — the single decision point", () => {
  it("picks borderActive (neon) when effects.glow is on", () => {
    expect(accentBorderFor(COLORS, GLOW)).toBe(COLORS.borderActive);
  });
  it("picks border (dim) when effects.glow is off", () => {
    expect(accentBorderFor(COLORS, NONE)).toBe(COLORS.border);
  });
  it("falls back to border when effects object is empty", () => {
    expect(accentBorderFor(COLORS, {})).toBe(COLORS.border);
  });
});

describe("glowText — respects the per-theme effects flag", () => {
  it("wraps in bold+accent when glow on", () => {
    const out = glowText("hello", COLORS, GLOW);
    expect(out).toContain("{bold}");
    expect(out).toContain(`{${COLORS.accent}-fg}`);
    expect(out).toContain("hello");
    // Tag-balanced: opens matched by explicit closes.
    expect(out).toContain("{/bold}");
    expect(out).toContain(`{/${COLORS.accent}-fg}`);
  });
  it("returns plain text when glow off", () => {
    expect(glowText("hello", COLORS, NONE)).toBe("hello");
  });
  it("wraps in a custom color when provided (label glow)", () => {
    const out = glowText("sentinel", COLORS, GLOW, COLORS.lime);
    expect(out).toContain(`{${COLORS.lime}-fg}`);
  });
});

describe("neonDivider — horizontal rule with optional center mark", () => {
  it("produces a line of the requested width in the accent color when glow on", () => {
    const out = neonDivider(40, COLORS, GLOW);
    // Tag-balanced, contains accent color, and the visible ─ chars fill the width.
    expect(out).toContain(`{${COLORS.accent}-fg}`);
    // Strip tags to measure visible width.
    const visible = out.replace(/\{[^}]*\}/g, "");
    expect(visible.length).toBe(40);
    expect(visible.startsWith("─")).toBe(true);
  });
  it("uses the dim border color when glow off", () => {
    const out = neonDivider(40, COLORS, NONE);
    expect(out).toContain(`{${COLORS.border}-fg}`);
    expect(out).not.toContain(`{${COLORS.accent}-fg}`);
  });
  it("places a ◆ center mark when opts.mark is set", () => {
    const out = neonDivider(40, COLORS, GLOW, { mark: true });
    const visible = out.replace(/\{[^}]*\}/g, "");
    expect(visible).toContain("◆");
  });
  it("uses bracket endpoints ◭ ╮ when opts.brackets", () => {
    const out = neonDivider(20, COLORS, GLOW, { brackets: true });
    const visible = out.replace(/\{[^}]*\}/g, "");
    expect(visible.startsWith("╭")).toBe(true);
    expect(visible.endsWith("╮")).toBe(true);
  });
  it("clamps to a minimum width of 4", () => {
    const out = neonDivider(1, COLORS, GLOW);
    const visible = out.replace(/\{[^}]*\}/g, "");
    expect(visible.length).toBeGreaterThanOrEqual(4);
  });
  it("produces balanced tags (every { has a matching {/})", () => {
    const out = neonDivider(40, COLORS, GLOW, { mark: true });
    const opens = (out.match(/\{[^{/}]/g) || []).length;
    const closes = (out.match(/\{\/\}/g) || []).length;
    expect(opens).toBe(closes);
  });
});

describe("pulseDot — breathing animation", () => {
  it("BREATHE_FRAMES has 8 steps (smooth cycle)", () => {
    expect(BREATHE_FRAMES).toHaveLength(8);
  });
  it("returns accent color at peak frame, dim at trough", () => {
    // Frame 0 = peak (bright), frame 4 = trough (dim).
    expect(pulseDot(0, COLORS)).toContain(COLORS.accent);
    expect(pulseDot(4, COLORS)).toContain(COLORS.textTertiary);
  });
  it("wraps the cycle on frame overflow", () => {
    const wrap = pulseDot(BREATHE_FRAMES.length, COLORS);
    const zero = pulseDot(0, COLORS);
    expect(wrap).toBe(zero);
  });
  it("produces a visible ● char", () => {
    const out = pulseDot(0, COLORS).replace(/\{[^}]*\}/g, "");
    expect(out).toContain("●");
  });
});
