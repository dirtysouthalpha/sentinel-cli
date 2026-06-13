import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export interface TabDef {
  id: string;
  title: string;
  active: boolean;
  pinned: boolean;
  modified: boolean;
}

export interface TabBarOptions {
  screen: blessed.Widgets.Screen;
  onTabSelect: (id: string) => void;
}

export function createTabBar(options: TabBarOptions): blessed.Widgets.BoxElement {
  const c = themeEngine.getBlessedColors();
  const { screen, onTabSelect } = options;

  const tabBar = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 1,
    style: {
      bg: c.bgTertiary,
      fg: c.textSecondary,
    },
    tags: true,
    mouse: true,
    clickable: true,
  });

  let tabs: TabDef[] = [];
  let tabPositions: { id: string; start: number; end: number }[] = [];

  function render(): void {
    if (tabs.length === 0) {
      tabBar.setContent(` {${c.cyan}-fg}◈ SENTINEL{/}  {${c.textTertiary}-fg}Ctrl+N new tab{/}`);
      screen.render();
      return;
    }

    const parts: string[] = [];
    tabPositions = [];
    let pos = 1;

    for (const tab of tabs) {
      const pin = tab.pinned ? "\u{1F4CC}" : "";
      const mod = tab.modified ? "*" : "";
      const label = `${pin}${tab.title}${mod}`;

      if (tab.active) {
        parts.push(`{${c.bgPrimary}-fg}{${c.cyan}-fg}{bold} ${label} {/}`);
      } else {
        parts.push(`{${c.textSecondary}-fg} ${label} {/}`);
      }

      const labelLen = label.length + 2;
      tabPositions.push({ id: tab.id, start: pos, end: pos + labelLen });
      pos += labelLen + 1;
    }

    tabBar.setContent(parts.join(`{${c.border}-fg}{/}`));
    screen.render();
  }

  tabBar.on("click", (mouse: { x: number }) => {
    for (const tp of tabPositions) {
      if (mouse.x >= tp.start && mouse.x <= tp.end) {
        onTabSelect(tp.id);
        break;
      }
    }
  });

  function updateTabs(newTabs: TabDef[]): void {
    tabs = newTabs;
    render();
  }

  (tabBar as any).updateTabs = updateTabs;

  return tabBar;
}
