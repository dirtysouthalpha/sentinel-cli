/**
 * Enhanced auto-completion with file paths, command args, and mentions
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { COMMAND_CATALOG } from "../core/command-catalog.js";
import { getRepoFiles } from "../core/files.js";

export type CompletionItem = {
  type: "command" | "file" | "mention" | "arg";
  label: string;
  description?: string;
  insert: string;
};

export class AutoCompleter {
  private box?: blessed.Widgets.BoxElement;
  private list?: blessed.Widgets.ListElement;
  private active = false;
  private query = "";
  private items: CompletionItem[] = [];
  private selectedIndex = 0;
  private projectRoot = "";
  private cursorPos = 0;

  constructor(private parent: blessed.Widgets.Screen, private inputCallback: (text: string) => void) {}

  setProjectRoot(root: string) {
    this.projectRoot = root;
  }

  async complete(text: string, cursorPos: number): Promise<CompletionItem | null> {
    this.query = text;
    this.cursorPos = cursorPos;

    // Determine completion type based on context
    const context = this.getContext(text, cursorPos);
    this.items = await this.getItems(context);
    this.selectedIndex = 0;

    if (this.items.length === 0) return null;

    // If only one match, return it immediately
    if (this.items.length === 1) {
      return this.items[0];
    }

    // Show completion menu
    this.show();
    return null;
  }

  private getContext(text: string, cursorPos: number): { type: "command" | "file" | "mention" | "arg"; prefix: string } {
    const beforeCursor = text.slice(0, cursorPos);
    const lastWord = beforeCursor.split(/\s+/).pop() || "";

    if (beforeCursor.startsWith("/")) {
      // Command completion
      return { type: "command", prefix: beforeCursor.slice(1) };
    } else if (lastWord.startsWith("@")) {
      // Mention completion (@file, @code, @repo)
      return { type: "mention", prefix: lastWord.slice(1) };
    } else if (text.includes("file:") || text.includes("read:") || text.includes("write:")) {
      // File completion
      return { type: "file", prefix: lastWord };
    } else {
      return { type: "arg", prefix: lastWord };
    }
  }

  private async getItems(context: { type: string; prefix: string }): Promise<CompletionItem[]> {
    switch (context.type) {
      case "command":
        return this.getCommandCompletions(context.prefix);

      case "file":
        return this.getFileCompletions(context.prefix);

      case "mention":
        return this.getMentionCompletions(context.prefix);

      case "arg":
        return this.getArgCompletions(context.prefix);

      default:
        return [];
    }
  }

  private getCommandCompletions(prefix: string): CompletionItem[] {
    const q = prefix.toLowerCase();
    return COMMAND_CATALOG
      .filter((cmd) => cmd.command.toLowerCase().startsWith(q) || cmd.description.toLowerCase().includes(q))
      .slice(0, 10)
      .map((cmd) => ({
        type: "command" as const,
        label: cmd.command,
        description: cmd.description,
        insert: cmd.command + " ",
      }));
  }

  private async getFileCompletions(prefix: string): Promise<CompletionItem[]> {
    if (!this.projectRoot) return [];

    const files = await getRepoFiles(this.projectRoot, { maxFiles: 100 });
    const q = prefix.toLowerCase();

    return files
      .filter((f) => f.toLowerCase().includes(q))
      .slice(0, 10)
      .map((file) => ({
        type: "file" as const,
        label: file,
        insert: file,
      }));
  }

  private getMentionCompletions(prefix: string): CompletionItem[] {
    const mentions = [
      { type: "mention", label: "@file", description: "File context", insert: "@file " },
      { type: "mention", label: "@code", description: "Code base context", insert: "@code " },
      { type: "mention", label: "@repo", description: "Repository context", insert: "@repo " },
      { type: "mention", label: "@commit", description: "Latest commit", insert: "@commit " },
      { type: "mention", label: "@diff", description: "Uncommitted changes", insert: "@diff " },
    ];

    const q = prefix.toLowerCase();
    return mentions
      .filter((m) => m.label.toLowerCase().startsWith(q))
      .map((m) => ({ ...m, type: "mention" as const }));
  }

  private getArgCompletions(prefix: string): CompletionItem[] {
    // Common suggestions based on previous commands
    const commonArgs = [
      "true", "false",
      "src/", "dist/", "test/",
      "npm run", "npm test", "npm build",
      "git add", "git commit", "git push",
      ".ts", ".js", ".json", ".md",
    ];

    const q = prefix.toLowerCase();
    return commonArgs
      .filter((arg) => arg.toLowerCase().startsWith(q))
      .map((arg) => ({
        type: "arg",
        label: arg,
        insert: arg,
      }));
  }

  private show() {
    this.createUI();
    this.render();
    this.box!.show();
    this.box!.setFront();
    this.parent.render();
    this.active = true;
  }

  private createUI() {
    if (this.box) return;

    const c = themeEngine.getBlessedColors();

    this.box = blessed.box({
      parent: this.parent,
      left: 3,
      bottom: 4,
      width: "50%",
      height: Math.min(12, this.items.length + 2),
      hidden: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    this.list = blessed.list({
      parent: this.box,
      top: 0,
      left: 0,
      width: "100%-2",
      height: "100%",
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
    this.list.key(["tab"], () => this.select());
    this.box.key(["escape"], () => this.hide());
  }

  private render() {
    if (!this.list) return;

    const c = themeEngine.getBlessedColors();
    const items = this.items.map((item, i) => {
      const icon = item.type === "command" ? "🔧" :
                   item.type === "file" ? "📄" :
                   item.type === "mention" ? "📎" : "💡";

      const prefix = i === this.selectedIndex ? " " : " ";
      const label = this.highlightMatch(item.label, this.query);
      const desc = item.description ? `{${c.textTertiary}-fg} — ${item.description}{/}` : "";

      return `${prefix}{${c.textSecondary}-fg}${icon}{/} {${c.textPrimary}-fg}${label}{/}${desc}`;
    });

    this.list.setItems(items);
    this.list.select(this.selectedIndex);
    this.parent.render();
  }

  private select() {
    if (this.items.length === 0) return;
    const item = this.items[this.selectedIndex];
    this.hide();
    this.inputCallback(item.insert);
  }

  private highlightMatch(text: string, query: string): string {
    if (!query) return text;

    const q = query.toLowerCase();
    const t = text.toLowerCase();

    // Simple prefix highlighting
    if (t.startsWith(q)) {
      const c = themeEngine.getBlessedColors();
      return `{${c.cyan}-fg}${text.slice(0, q.length)}{/}${text.slice(q.length)}`;
    }

    return text;
  }

  hide() {
    if (this.box) {
      this.box.hide();
      this.parent.render();
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  moveSelection(dir: number) {
    if (!this.active || this.items.length === 0) return;

    this.selectedIndex = (this.selectedIndex + dir + this.items.length) % this.items.length;
    this.render();
  }
}