/**
 * Pure palette helpers for the animated background canvas. Split out from the
 * DOM/canvas module so the color math is unit-testable without a browser.
 *
 * The background reads the live `--accent-rgb` CSS variable (which the theme
 * system swaps per theme) so the particle field recolors with the active theme.
 */

const DEFAULT_ACCENT: [number, number, number] = [59, 130, 246]; // GUI default blue

/**
 * Parse a hex color (#RRGGBB, RRGGBB, #RGB, or RGB) to an [r, g, b] tuple.
 * Returns null for anything that isn't a valid hex color.
 */
export function hexToRGB(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, "").trim();
  if (!h) return null;
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return [r, g, b];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return [r, g, b];
  }
  return null;
}

/**
 * Parse the `--accent-rgb` CSS variable value (a "r, g, b" string) into a
 * tuple. Falls back to the GUI's default blue when the value is missing or
 * malformed — the background never breaks because of a bad theme var.
 */
export function readAccentRGB(value: string | null | undefined): [number, number, number] {
  if (!value) return DEFAULT_ACCENT;
  const parts = value.split(",").map((p) => parseInt(p.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return DEFAULT_ACCENT;
  return [parts[0], parts[1], parts[2]];
}
