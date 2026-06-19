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
    const fx = themeEngine.getEffects();
    if (tabs.length === 0) {
      tabBar.setContent(` {${c.textTertiary}-fg}No tabs — Ctrl+N to create{/}`);
      screen.render();
      return;
    }

    const parts: string[] = [];
    tabPositions = [];
    let pos = 1;

    for (const tab of tabs) {
      const pin = tab.pinned ? "\u{1F4CC}" : "";
      const mod = tab.modified ? "*" : "";
      // Strip blessed tag braces from the user-set title so a `{` can't corrupt
      // the bar (and throw off click geometry for every tab after it).
      const safeTitle = tab.title.replace(/[{}]/g, "");
      const label = `${pin}${safeTitle}${mod}`;

      if (tab.active) {
        // Active tab: glowing pill + a ▔ underline rail when glow on.
        const underline = fx.glow ? ` {${c.accent}-fg}\u2574{/${c.accent}-fg}` : "";
        parts.push(`{${c.cyan}-bg}{${c.bgPrimary}-fg}{bold} ${label} {/}${underline}`);
      } else {
        parts.push(`{${c.textSecondary}-fg} ${label} {/}`);
      }

      const labelLen = label.length + 2;
      tabPositions.push({ id: tab.id, start: pos, end: pos + labelLen });
      pos += labelLen + 1; // +1 for the 1-column separator rendered below
    }

    // Accent separators when glow on, dim border otherwise.
    const sepColor = fx.glow ? c.accent : c.border;
    tabBar.setContent(parts.join(`{${sepColor}-fg}│{/${sepColor}-fg}`));
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
