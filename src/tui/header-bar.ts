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
    const title = state.get("sessionTitle") || "Session 1";
    const breadcrumb = getBreadcrumb();
    const model = state.get("currentModel").split("/").pop() || "";
    const agent = state.get("currentAgent");

    headerBar.setContent(
      ` {${c.amber}-fg}\u25CF{/} {bold}${title}{/} ` +
      `{${c.border}-fg}\u2502{/} ` +
      `${breadcrumb} ` +
      `{${c.border}-fg}\u2502{/} ` +
      `{${c.textTertiary}-fg}${agent}{/}` +
      `{${c.border}-fg}\u2502{/} ` +
      `{${c.textTertiary}-fg}${model}{/} `
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
