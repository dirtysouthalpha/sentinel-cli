/**
 * Neon border + glow decoration helpers — pure layer.
 *
 * These build the tagged-string decorations that turn the TUI from flat text
 * into a cyberpunk HUD. Pure: no blessed objects, no screen I/O, no side
 * effects. They take the already-resolved BlessedColors + the theme's
 * ThemeEffects and return balanced `{tag}` strings.
 *
 * THE EFFECTS FLAGS BECOME REAL HERE. Every cyberpunk theme defines an
 * effects object (glow/pulse/scanlines/grid) that was previously dead data;
 * these helpers read it and pick neon-accent vs dim accordingly. Non-cyberpunk
 * themes have no effects → everything resolves to the calm dim border → no
 * regression for users who want a clean look.
 */

import type { BlessedColors, ThemeEffects } from "./themes/types.js";

/**
 * The single decision point for "neon or calm?". Returns the bright
 * borderActive (neon accent) when the theme wants glow, the dim border
 * otherwise. Every decoration routes through this.
 */
export function accentBorderFor(colors: BlessedColors, effects: ThemeEffects): string {
  return effects.glow ? colors.borderActive : colors.border;
}

/**
 * Wrap text in a glow (bold + accent color) when the theme wants it, else
 * return plain. `color` overrides the accent (e.g. a lime label on a cyan
 * card). Replaces the dead engine.applyEffectsToText with a version that
 * actually respects the per-theme effects flag.
 */
export function glowText(
  text: string,
  colors: BlessedColors,
  effects: ThemeEffects,
  color?: string
): string {
  if (!effects.glow) return text;
  const c = color ?? colors.accent;
  return `{bold}{${c}-fg}${text}{/${c}-fg}{/bold}`;
}

/**
 * Build a horizontal divider rule. Neon accent when glow on, dim border when
 * off. Optional `◆` center mark and `╭`/`╮` bracket endpoints for framed
 * sections. Always tag-balanced and clamped to a visible minimum of 4 cols.
 */
export function neonDivider(
  width: number,
  colors: BlessedColors,
  effects: ThemeEffects,
  opts: { mark?: boolean; brackets?: boolean } = {}
): string {
  const w = Math.max(4, width);
  const c = accentBorderFor(colors, effects);
  const tag = (s: string) => `{${c}-fg}${s}{/}`;

  if (opts.mark) {
    // ◆ in the center, flanked by dashes.
    const side = Math.max(1, Math.floor((w - 1) / 2));
    const dashes = "─".repeat(side);
    const pad = w - 1 - side * 2 > 0 ? "─".repeat(w - 1 - side * 2) : "";
    return tag(`${dashes}◆${dashes}${pad}`);
  }
  if (opts.brackets) {
    // ╭────╮  (bracket endpoints + dashes between)
    const inner = Math.max(0, w - 2);
    return tag(`╭${"─".repeat(inner)}╮`);
  }
  return tag("─".repeat(w));
}

/** 8-step breathing cycle for the status dot: peak → trough → peak. */
export const BREATHE_FRAMES = [0, 1, 2, 3, 4, 3, 2, 1] as const;

/**
 * The breathing status dot for a given animation frame. Cycles between the
 * bright accent (peak, frame 0) and the dim textTertiary (trough, frame 4).
 * `frame` wraps modulo BREATHE_FRAMES.length.
 */
export function pulseDot(frame: number, colors: BlessedColors): string {
  const f = BREATHE_FRAMES[((frame % BREATHE_FRAMES.length) + BREATHE_FRAMES.length) % BREATHE_FRAMES.length];
  // 0 = full bright accent, 4 = dim trough. Lerp between by picking accent for
  // frames 0-2, dim for 3-4, brightening back for 2-1.
  const bright = f <= 2;
  const c = bright ? colors.accent : colors.textTertiary;
  const prefix = f === 0 ? "{bold}" : "";
  const suffix = f === 0 ? "{/bold}" : "";
  return `${prefix}{${c}-fg}●{/${c}-fg}${suffix}`;
}

/**
 * Pulsing prompt char (`❯`) for a given animation frame. Bright at peak,
 * dim at trough. Gives the idle input box a heartbeat.
 */
export function pulsePrompt(frame: number, colors: BlessedColors): string {
  const f = BREATHE_FRAMES[((frame % BREATHE_FRAMES.length) + BREATHE_FRAMES.length) % BREATHE_FRAMES.length];
  const bright = f <= 2;
  const c = bright ? colors.accent : colors.textTertiary;
  return `{${c}-fg}❯{/${c}-fg}`;
}
