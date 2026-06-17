import { themeEngine } from "../themes/engine.js";

/**
 * Truecolor palette for the Ink renderer, pulled from the active theme. Ink/chalk
 * emit 24-bit color from hex strings, so these render exactly (unlike blessed,
 * which downsampled to the 256-color palette and lost the dim greys).
 */
export interface InkPalette {
  bg: string;
  primary: string;
  secondary: string;
  tertiary: string;
  accent: string;
  ok: string;
  warn: string;
  err: string;
  rail: string;
}

export function palette(): InkPalette {
  const c = themeEngine.getBlessedColors();
  return {
    bg: c.bgPrimary,
    primary: c.textPrimary,
    secondary: c.textSecondary,
    tertiary: c.textTertiary,
    accent: c.cyan,
    ok: c.lime,
    warn: c.amber,
    err: c.error,
    rail: c.textSecondary,
  };
}
