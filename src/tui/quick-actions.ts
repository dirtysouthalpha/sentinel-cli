/**
 * Quick Action Palette - fuzzy-find launcher for commands, files, sessions
 * Inspired by VS Code Command Palette and opencode /menu
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { COMMAND_CATALOG, searchCatalog } from "../core/command-catalog.js";
import { sessionManager } from "../core/session-manager.js";
import { searchRepoIndex } from "../core/repo-index.js";
import { getRepoFiles } from "../core/files.js";
import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "quick-actions" });

export type QuickActionCategory = "command" | "file" | "session" | "tool" | "history";

export interface QuickActionItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: QuickActionCategory;
  action: () => void | Promise<void>;
  metadata?: Record<string, unknown>;
}

export interface QuickActionsOptions {
  screen: blessed.Widgets.Screen;
  onSelect: (item: QuickActionItem) => void;
  onClose: () => void;
}

export class QuickActionsModal {
  private box!: blessed.Widgets.BoxElement;
  private input!: blessed.Widgets.TextElement;
  private list!: blessed.Widgets.ListElement;
  private active = false;
  private query = "";
  private selectedIndex = 0;
  private items: QuickActionItem[] = [];
  private filtered: QuickActionItem[] = [];

  constructor(private options: QuickActionsOptions) {
    this.createUI();
    this.setupKeys();
  }

  private createUI() {
    const c = themeEngine.getBlessedColors();

    // Overlay box
    this.box = blessed.box({
      parent: this.options.screen,
      left: "center",
      top: "center",
      width: "70%",
      height: "60%",
      hidden: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    // Title bar
    const title = blessed.text({
      parent: this.box,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 1,
      content: `{${c.accent}-fg}{bold}Quick Actions{/} {${c.textTertiary}-fg}(Ctrl+T){/}`,
      tags: true,
    });

    // Input field
    this.input = blessed.text({
      parent: this.box,
      top: 2,
      left: 1,
      width: "100%-2",
      height: 1,
      content: `{${c.cyan}-fg}❯{/} `,
      tags: true,
      style: { fg: c.textPrimary },
    });

    // List of actions
    this.list = blessed.list({
      parent: this.box,
      top: 4,
      left: 1,
      width: "100%-2",
      height: "100%-5",
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      style: {
        fg: c.textPrimary,
        bg: c.bgPrimary,
        selected: {
          fg: c.textPrimary,
          bg: c.accent || c.bgSecondary,
          bold: true,
        },
      },
    });

    this.list.on("select", () => this.select());
    this.box.on("keypress", (ch, key) => this.onKeypress(ch, key));
  }

  private setupKeys() {
    this.list.key(["escape", "C-c"], () => this.hide());
  }

  private onKeypress(ch: string, key: blessed.Keys) {
    if (!this.active) return;

    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      this.hide();
      return;
    }

    if (key.name === "return" || key.name === "enter") {
      this.select();
      return;
    }

    if (key.name === "up" || key.name === "k") {
      this.moveSelection(-1);
      return;
    }

    if (key.name === "down" || key.name === "j") {
      this.moveSelection(1);
      return;
    }

    if (key.name === "C-u") {
      this.query = "";
      this.update();
      return;
    }

    if (key.name === "C-w") {
      const words = this.query.trim().split(/\s+/);
      words.pop();
      this.query = words.join(" ");
      this.update();
      return;
    }

    // Handle printable characters
    if (key.full && key.full.length === 1 && !key.ctrl) {
      const char = key.full;
      if (char.charCodeAt(0) >= 32) {
        this.query += char;
        this.update();
      }
    } else if (key.name === "backspace" || key.name === "delete") {
      this.query = this.query.slice(0, -1);
      this.update();
    }
  }

  private moveSelection(dir: number) {
    if (this.filtered.length === 0) return;
    this.selectedIndex = (this.selectedIndex + dir + this.filtered.length) % this.filtered.length;
    this.list.select(this.selectedIndex);
    this.options.screen.render();
  }

  private async select() {
    if (this.filtered.length === 0) return;
    const item = this.filtered[this.selectedIndex];
    this.hide();
    await item.action();
    this.options.onSelect(item);
  }

  private update() {
    const c = themeEngine.getBlessedColors();
    this.input.setContent(`{${c.cyan}-fg}❯{/} ${this.query.length > 0 ? this.query : "{grey}Type to search...{/}"}`);

    // Filter and rank items
    this.filtered = this.fuzzyFilter(this.items, this.query);
    this.selectedIndex = 0;

    // Update list
    const listItems = this.filtered.map((item, i) => {
      const mark = i === this.selectedIndex ? " " : " ";
      const categoryColor = this.getCategoryColor(item.category);
      return `${mark}{${categoryColor}-fg}${item.icon}{/} {${c.textPrimary}-fg}${this.highlightMatch(item.label, this.query)}{/}`;
    });

    this.list.setItems(listItems);
    if (this.filtered.length > 0) {
      this.list.select(0);
    }

    this.options.screen.render();
  }

  private fuzzyFilter(items: QuickActionItem[], query: string): QuickActionItem[] {
    if (!query.trim()) {
      // Return all items, grouped and sorted by category
      return items.sort((a, b) => {
        const categoryOrder: Record<QuickActionCategory, number> = {
          command: 0,
          session: 1,
          file: 2,
          tool: 3,
          history: 4,
        };
        return categoryOrder[a.category] - categoryOrder[b.category] || a.label.localeCompare(b.label);
      });
    }

    const q = query.toLowerCase();
    return items
      .map((item) => ({
        item,
        score: this.fuzzyScore(item.label.toLowerCase(), q) + this.fuzzyScore(item.description.toLowerCase(), q) * 0.5,
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }

  private fuzzyScore(text: string, query: string): number {
    if (!query) return 0;
    if (text.startsWith(query)) return 100;
    if (text.includes(query)) return 50;

    // Fuzzy match
    let score = 0;
    let queryIdx = 0;
    let textIdx = 0;

    while (queryIdx < query.length && textIdx < text.length) {
      if (text[textIdx] === query[queryIdx]) {
        score += 10;
        queryIdx++;
      } else {
        score -= 1;
      }
      textIdx++;
    }

    if (queryIdx === query.length) {
      // Bonus for consecutive matches
      score += query.length * 5;
    }

    return Math.max(0, score);
  }

  private highlightMatch(text: string, query: string): string {
    if (!query) return text;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let result = "";
    let i = 0;
    let j = 0;

    while (i < text.length && j < q.length) {
      if (t[i] === q[j]) {
        result += `{${themeEngine.getBlessedColors().cyan}-fg}${text[i]}{/}`;
        j++;
      } else {
        result += text[i];
      }
      i++;
    }

    if (i < text.length) {
      result += text.slice(i);
    }

    return result;
  }

  private getCategoryColor(category: QuickActionCategory): string {
    const c = themeEngine.getBlessedColors();
    const colors: Record<QuickActionCategory, string> = {
      command: "cyan",
      session: "lime",
      file: "magenta",
      tool: "yellow",
      history: "blue",
    };
    return c[colors[category] as keyof typeof c] || c.textPrimary;
  }

  async loadActions(projectRoot: string) {
    this.items = [
      ...await this.getCommandActions(),
      ...await this.getSessionActions(),
      ...await this.getFileActions(projectRoot),
      ...await this.getToolActions(),
    ];
  }

  private async getCommandActions(): Promise<QuickActionItem[]> {
    return COMMAND_CATALOG.map((cmd) => ({
      id: cmd.command,
      label: cmd.command,
      description: cmd.description,
      icon: "🔧",
      category: "command" as QuickActionCategory,
      action: async () => {
        this.options.onClose();
        // Let the main app handle the command
        (globalThis as { handleQuickCommand?: (cmd: string) => void }).handleQuickCommand?.(cmd.command);
      },
    }));
  }

  private async getSessionActions(): Promise<QuickActionItem[]> {
    const sessions = sessionManager.getAllSessions();
    return sessions.map((session) => ({
      id: `session:${session.id}`,
      label: session.projectName || "Untitled Session",
      description: `${session.messages || 0} messages · ${new Date(session.lastActive || 0).toLocaleTimeString()}`,
      icon: "💬",
      category: "session" as QuickActionCategory,
      action: async () => {
        sessionManager.switchToSession(session.id);
        this.options.onClose();
      },
    }));
  }

  private async getFileActions(projectRoot: string): Promise<QuickActionItem[]> {
    try {
      const files = await getRepoFiles(projectRoot);
      return files.slice(0, 100).map((file) => ({
        id: `file:${file}`,
        label: file,
        description: "Open file",
        icon: "📄",
        category: "file" as QuickActionCategory,
        action: async () => {
          this.options.onClose();
          (globalThis as { handleQuickFile?: (file: string) => void }).handleQuickFile?.(file);
        },
      }));
    } catch (err) {
      log.error(`Failed to load files: ${err}`);
      return [];
    }
  }

  private async getToolActions(): Promise<QuickActionItem[]> {
    // MCP tools would be added here
    return [
      {
        id: "tool:file-read",
        label: "file:read",
        description: "Read file contents",
        icon: "🔍",
        category: "tool" as QuickActionCategory,
        action: async () => {
          this.query = "file:read ";
          this.update();
        },
      },
      {
        id: "tool:file-write",
        label: "file:write",
        description: "Write/create file",
        icon: "✏️",
        category: "tool" as QuickActionCategory,
        action: async () => {
          this.query = "file:write ";
          this.update();
        },
      },
      {
        id: "tool:bash",
        label: "bash",
        description: "Run shell command",
        icon: "💻",
        category: "tool" as QuickActionCategory,
        action: async () => {
          this.query = "bash ";
          this.update();
        },
      },
    ];
  }

  show() {
    this.active = true;
    this.query = "";
    this.selectedIndex = 0;
    this.update();
    this.box.show();
    this.box.setFront();
    this.input.focus();
    this.options.screen.render();
  }

  hide() {
    this.active = false;
    this.box.hide();
    this.options.onClose();
    this.options.screen.render();
  }

  toggle() {
    if (this.active) {
      this.hide();
    } else {
      this.show();
    }
  }
}

// Helper: get repository files
async function getRepoFiles(root: string, maxDepth = 3): Promise<string[]> {
  const files: string[] = [];
  const queue = [{ path: root, depth: 0 }];
  const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "target", "vendor"]);
  const ignoreExts = new Set([".log", ".lock", ".cache"]);

  while (queue.length > 0 && files.length < 500) {
    const { path: currentPath, depth } = queue.shift()!;

    if (depth > maxDepth) continue;

    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        const relativePath = fullPath.replace(root + "/", "");

        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name)) {
            queue.push({ path: fullPath, depth: depth + 1 });
          }
        } else if (entry.isFile()) {
          const ext = entry.name.split(".").pop();
          if (ext && !ignoreExts.has(`.${ext}`)) {
            files.push(relativePath);
          }
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  return files.sort();
}