import { ThemeDef, ThemeEffects, colorsToCSS, themeToBlessedColors } from "./types.js";
import { ALL_THEMES } from "./variants/index.js";
import { events } from "../../core/events.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger({ prefix: "theme" });

class ThemeEngine {
  private currentTheme: ThemeDef;
  private customCSS: string = "";
  private static instance: ThemeEngine;

  private constructor() {
    this.currentTheme = ALL_THEMES[0];
  }

  static getInstance(): ThemeEngine {
    if (!ThemeEngine.instance) {
      ThemeEngine.instance = new ThemeEngine();
    }
    return ThemeEngine.instance;
  }

  getTheme(): ThemeDef {
    return this.currentTheme;
  }

  getThemeByName(name: string): ThemeDef | undefined {
    return ALL_THEMES.find((t) => t.name === name);
  }

  getAllThemes(): ThemeDef[] {
    return [...ALL_THEMES];
  }

  setTheme(name: string): boolean {
    const theme = ALL_THEMES.find((t) => t.name === name);
    if (!theme) {
      log.warn(`Theme "${name}" not found`);
      return false;
    }
    this.currentTheme = theme;
    events.emit("theme:changed", name);
    log.info(`Theme switched to ${theme.display}`);
    return true;
  }

  cycleTheme(): string {
    const currentIndex = ALL_THEMES.indexOf(this.currentTheme);
    const nextIndex = (currentIndex + 1) % ALL_THEMES.length;
    const nextTheme = ALL_THEMES[nextIndex];
    this.setTheme(nextTheme.name);
    return nextTheme.name;
  }

  getColors() {
    return this.currentTheme.colors;
  }

  getEffects(): ThemeEffects {
    return this.currentTheme.effects || {};
  }

  getCSSVariables(): Record<string, string> {
    return colorsToCSS(this.currentTheme.colors);
  }

  getBlessedColors() {
    return themeToBlessedColors(this.currentTheme.colors);
  }

  setCustomCSS(css: string): void {
    this.customCSS = css;
  }

  getCustomCSS(): string {
    return this.customCSS;
  }

  applyEffectsToText(text: string, effect: "glow" | "pulse"): string {
    const colors = this.currentTheme.colors;
    switch (effect) {
      case "glow":
        return `{bold}{${colors.accentPrimary}-fg}${text}{/${colors.accentPrimary}-fg}{/bold}`;
      case "pulse":
        return `{${colors.accentPrimary}-fg}${text}{/${colors.accentPrimary}-fg}`;
      default:
        return text;
    }
  }

  getStatusBarText(): string {
    const colors = this.currentTheme.colors;
    const theme = this.currentTheme;
    return `{${colors.cyan}-fg}SENTINEL{/} {${colors.textTertiary}-fg}│{/} ` +
      `{bold}Theme:{/} ${theme.display} ` +
      `{${colors.textTertiary}-fg}│{/} ` +
      `{${colors.accentPrimary}-fg}${Object.keys(ALL_THEMES).length}{/} themes available`;
  }
}

export const themeEngine = ThemeEngine.getInstance();
