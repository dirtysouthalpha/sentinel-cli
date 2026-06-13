import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { basename } from "path";

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
      bg: c.bgTertiary,
      fg: c.textSecondary,
    },
    tags: true,
  });

  function render(): void {
    const c2 = themeEngine.getBlessedColors();
    const title = state.get("sessionTitle") || "Session 1";
    const model = (state.get("currentModel") as string).split("/").pop() || "";
    const agent = state.get("currentAgent") as string;

    const cwd = (state.get("currentWorkingDir") as string) || projectRoot;
    const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    // show last 2 path segments
    const dirDisplay = parts.slice(-2).join("/") || basename(projectRoot);

    const sep = `  {${c2.border}-fg}▌{/}  `;

    headerBar.setContent(
      ` {${c2.cyan}-fg}{bold}◈{/}  ` +
      `{bold}${title}{/}` +
      `${sep}{${c2.textTertiary}-fg}${dirDisplay}{/}` +
      `${sep}{${c2.accent || c2.cyan}-fg}${agent}{/}` +
      `${sep}{${c2.textSecondary}-fg}${model}{/} `
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
