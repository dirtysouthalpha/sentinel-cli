import { describe, it, expect } from "vitest";
import { themeEngine } from "../src/tui/themes/engine.js";

describe("ThemeEngine", () => {
  it("should have 20 themes", () => {
    const themes = themeEngine.getAllThemes();
    expect(themes).toHaveLength(20);
  });

  it("includes the new cyberpunk/tron themes", () => {
    const names = themeEngine.getAllThemes().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      "vaporwave", "synthwave", "outrun", "glitch", "hologram",
    ]));
  });

  it("each new theme has the full color palette (no missing roles)", () => {
    const required = ["accentPrimary", "cyan", "lime", "amber", "error", "magenta", "purple", "textPrimary"];
    for (const name of ["vaporwave", "synthwave", "outrun", "glitch", "hologram"]) {
      const t = themeEngine.getAllThemes().find((x) => x.name === name)!;
      for (const key of required) {
        expect(t.colors[key as keyof typeof t.colors], `${name}.${key}`).toBeTruthy();
      }
    }
  });

  it("should default to cyberpunk theme", () => {
    const theme = themeEngine.getTheme();
    expect(theme.name).toBe("cyberpunk");
  });

  it("should switch themes", () => {
    const result = themeEngine.setTheme("matrix");
    expect(result).toBe(true);
    expect(themeEngine.getTheme().name).toBe("matrix");
    themeEngine.setTheme("cyberpunk");
  });

  it("should return false for unknown theme", () => {
    const result = themeEngine.setTheme("nonexistent");
    expect(result).toBe(false);
  });

  it("should cycle themes", () => {
    themeEngine.setTheme("cyberpunk");
    const next = themeEngine.cycleTheme();
    expect(next).toBe("light");
    expect(themeEngine.getTheme().name).toBe("light");
    themeEngine.setTheme("cyberpunk");
  });

  it("should return CSS variables", () => {
    const vars = themeEngine.getCSSVariables();
    expect(vars).toHaveProperty("--bg-primary");
    expect(vars).toHaveProperty("--accent-primary");
    expect(vars).toHaveProperty("--text-primary");
  });

  it("should return blessed colors", () => {
    const colors = themeEngine.getBlessedColors();
    expect(colors).toHaveProperty("bg");
    expect(colors).toHaveProperty("fg");
    expect(colors).toHaveProperty("accent");
  });

  it("should find theme by name", () => {
    const theme = themeEngine.getThemeByName("matrix");
    expect(theme?.name).toBe("matrix");
    expect(theme?.display).toBe("Matrix");
  });

  it("all themes should have required color properties", () => {
    const themes = themeEngine.getAllThemes();
    const requiredKeys = [
      "accentPrimary", "bgPrimary", "textPrimary",
      "border", "success", "error", "cyan", "lime",
    ];

    for (const theme of themes) {
      for (const key of requiredKeys) {
        expect(theme.colors).toHaveProperty(key, expect.any(String));
      }
    }
  });
});
