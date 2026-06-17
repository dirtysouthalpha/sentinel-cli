export interface ThemeColors {
  accentPrimary: string;
  accentHover: string;
  accentSecondary: string;

  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  border: string;
  borderActive: string;

  success: string;
  warning: string;
  error: string;
  info: string;

  cyan: string;
  lime: string;
  amber: string;
  magenta: string;
  purple: string;
}

export interface ThemeDef {
  name: string;
  display: string;
  description: string;
  colors: ThemeColors;
  effects?: ThemeEffects;
}

export interface ThemeEffects {
  scanlines?: boolean;
  glow?: boolean;
  pulse?: boolean;
  grid?: boolean;
  chamferButtons?: boolean;
  accentBar?: boolean;
  glowIntensity?: number;
  scanlineOpacity?: number;
}

export function colorsToCSS(colors: ThemeColors): Record<string, string> {
  return {
    "--accent-primary": colors.accentPrimary,
    "--accent-hover": colors.accentHover,
    "--accent-secondary": colors.accentSecondary,
    "--bg-primary": colors.bgPrimary,
    "--bg-secondary": colors.bgSecondary,
    "--bg-tertiary": colors.bgTertiary,
    "--text-primary": colors.textPrimary,
    "--text-secondary": colors.textSecondary,
    "--text-tertiary": colors.textTertiary,
    "--border-color": colors.border,
    "--border-active": colors.borderActive,
    "--success": colors.success,
    "--warning": colors.warning,
    "--error": colors.error,
    "--info": colors.info,
    "--cyan": colors.cyan,
    "--lime": colors.lime,
    "--amber": colors.amber,
    "--magenta": colors.magenta,
    "--purple": colors.purple,
  };
}

export interface BlessedColors {
  bg: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  fg: string;
  fgPrimary: string;
  fgSecondary: string;
  fgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderActive: string;
  accent: string;
  accentHover: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  cyan: string;
  lime: string;
  amber: string;
  magenta: string;
  purple: string;
}

export function themeToBlessedColors(colors: ThemeColors): BlessedColors {
  return {
    bg: colors.bgPrimary,
    bgPrimary: colors.bgPrimary,
    bgSecondary: colors.bgSecondary,
    bgTertiary: colors.bgTertiary,
    fg: colors.textPrimary,
    fgPrimary: colors.textPrimary,
    fgSecondary: colors.textSecondary,
    fgTertiary: colors.textTertiary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    textTertiary: colors.textTertiary,
    border: colors.border,
    borderActive: colors.borderActive,
    accent: colors.accentPrimary,
    accentHover: colors.accentHover,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    info: colors.info,
    cyan: colors.cyan,
    lime: colors.lime,
    amber: colors.amber,
    magenta: colors.magenta,
    purple: colors.purple,
  };
}
