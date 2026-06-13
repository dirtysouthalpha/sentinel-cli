import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { TodoStore, TodoItem } from "../core/todos.js";

export class TodoPanel {
  private box: blessed.Widgets.BoxElement;
  private screen: blessed.Widgets.Screen;
  private store: TodoStore;
  private visible: boolean = false;

  constructor(opts: { screen: blessed.Widgets.Screen; store: TodoStore }) {
    this.screen = opts.screen;
    this.store = opts.store;

    const c = themeEngine.getBlessedColors();

    this.box = blessed.box({
      parent: this.screen,
      top: 2,
      right: 0,
      width: "30%",
      bottom: 4,
      style: {
        bg: c.bgSecondary,
        fg: c.textPrimary,
        border: { fg: c.border },
      },
      border: { type: "line" },
      label: " TODOS ",
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
    });

    this.box.hide();

    this.store.onChange(() => {
      if (this.visible) this.refresh();
    });
  }

  refresh(): void {
    const items = this.store.get();
    const c = themeEngine.getBlessedColors();
    const lines: string[] = [];

    if (items.length === 0) {
      lines.push(`{${c.textTertiary}-fg}  No active todos{/}`);
    }

    const width = Math.max((this.box.width as number) - 4, 10);

    for (const item of items) {
      const { icon, color } = this.renderStatus(item);
      const text = item.content.length > width - 4
        ? item.content.slice(0, width - 5) + "…"
        : item.content;
      lines.push(` {${color}-fg}${icon}{/} {${color}-fg}${text}{/}`);
    }

    // Progress bar
    lines.push("");
    const done = items.filter((t) => t.status === "completed").length;
    const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0;
    const barWidth = Math.max(width - 8, 6);
    const filled = Math.round((pct / 100) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    lines.push(` {${c.lime}-fg}${bar}{/} {bold}${pct}%{/}`);

    this.box.setContent(lines.join("\n"));
    this.screen.render();
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) {
      this.box.show();
      this.refresh();
    } else {
      this.box.hide();
      this.screen.render();
    }
  }

  destroy(): void {
    this.box.destroy();
  }

  private renderStatus(item: TodoItem): { icon: string; color: string } {
    const c = themeEngine.getBlessedColors();
    switch (item.status) {
      case "completed":
        return { icon: "✓", color: c.success };
      case "in_progress":
        return { icon: "◆", color: c.amber };
      default:
        return { icon: "○", color: c.textTertiary };
    }
  }
}
