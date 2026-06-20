import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { basename, sep } from "path";

export interface HeaderBarOptions {
  screen: blessed.Widgets.Screen;
  projectRoot: string;
}

export function createHeaderBar(options: HeaderBarOptions): blessed.Widgets.BoxElement {
  const c = themeEngine.getBlessedColors();
  const { screen, projectRoot } = options;

  const headerBar = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: "100%",
    height: 1,
    style: {
      bg: c.bgSecondary,
      fg: c.textSecondary,
    },
    tags: true,
  });

  function getBreadcrumb(): string {
    const cwd = state.get("currentWorkingDir") || projectRoot;
    const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    const displayParts = parts.slice(-3);
    const projectName = displayParts[0] || basename(projectRoot);
    const rest = displayParts.slice(1);
    const breadcrumb = rest.length > 0
      ? `{${c.cyan}-fg}${projectName}{/} {${c.textTertiary}-fg}\u203A{/} ` +
        rest.map((p) => `{${c.textSecondary}-fg}${p}{/}`).join(` {${c.textTertiary}-fg}\u203A{/} `)
      : `{${c.cyan}-fg}${projectName}{/}`;
    return breadcrumb;
  }

  function render(): void {
    const fx = themeEngine.getEffects();
    const title = state.get("sessionTitle") || "Session 1";
    const breadcrumb = getBreadcrumb();
    const model = state.get("currentModel").split("/").pop() || "";
    const agent = state.get("currentAgent");

    // Glow the session dot when the theme wants it; accent the breadcrumb marks.
    const dot = fx.glow
      ? `{bold}{${c.cyan}-fg}\u25CF{/${c.cyan}-fg}{/bold}`
      : `{${c.cyan}-fg}\u25CF{/${c.cyan}-fg}`;
  

    headerBar.setContent(
      ` ${dot} {bold}${title}{/}   ` +
      `${breadcrumb}   ` +
      `{${sep}-fg}${agent} \u00B7 ${model}{/${sep}-fg} {${sep}-fg}\u2578{/${sep}-fg} `
    );
    screen.render();
  }

  state.subscribe("sessionTitle", render);
  state.subscribe("currentModel", render);
  state.subscribe("currentAgent", render);
  state.subscribe("currentWorkingDir", render);

  render();

  return headerBar;
}
