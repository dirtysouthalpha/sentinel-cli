/**
 * Enhanced keyboard shortcuts system
 * Power-user keybindings inspired by vim, emacs, and modern CLI tools
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export type ShortcutAction = () => void | Promise<void>;

export interface KeyboardShortcut {
  key: string;
  description: string;
  action: ShortcutAction;
  category?: "editing" | "navigation" | "session" | "search" | "tools";
}

export class KeyboardManager {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private helpModal?: blessed.Widgets.BoxElement;
  private historyRing: string[] = [];
  private historyIndex = -1;
  private killRing: string[] = [];

  constructor(private screen: blessed.Widgets.Screen) {
    this.registerDefaults();
  }

  private registerDefaults() {
    // Editing shortcuts
    this.register("C-k", "Kill to end of line", () => this.killToEOL(), "editing");
    this.register("C-u", "Kill to beginning of line", () => this.killToBOL(), "editing");
    this.register("C-w", "Delete previous word", () => this.deletePreviousWord(), "editing");
    this.register("C-y", "Yank (paste) killed text", () => this.yank(), "editing");
    this.register("M-f", "Forward word", () => this.forwardWord(), "editing");
    this.register("M-b", "Backward word", () => this.backwardWord(), "editing");
    this.register("C-d", "Delete forward char", () => this.deleteForward(), "editing");
    this.register("C-h", "Delete backward char", () => this.deleteBackward(), "editing");
    this.register("C-t", "Transpose chars", () => this.transposeChars(), "editing");

    // Navigation shortcuts
    this.register("M-<", "Beginning of file", () => this.jumpToStart(), "navigation");
    this.register("M->", "End of file", () => this.jumpToEnd(), "navigation");
    this.register("C-v", "Page down", () => this.pageDown(), "navigation");
    this.register("M-v", "Page up", () => this.pageUp(), "navigation");
    this.register("C-l", "Clear screen", () => this.clearScreen(), "navigation");

    // Session shortcuts
    this.register("C-o", "Multi-line mode", () => this.toggleMultiLine(), "session");
    this.register("C-p", "Quick actions", () => this.showQuickActions(), "session");
    this.register("C-s", "Save session", () => this.saveSession(), "session");
    this.register("C-r", "Reverse search history", () => this.reverseSearch(), "session");
    this.register("C-x r", "Record macro", () => this.recordMacro(), "session");
    this.register("C-x e", "Execute macro", () => this.executeMacro(), "session");

    // Search shortcuts
    this.register("C-g", "Search in chat", () => this.searchChat(), "search");
    this.register("C-n", "Next search result", () => this.nextSearchResult(), "search");
    this.register("C-p", "Previous search result", () => this.prevSearchResult(), "search");

    // Tool shortcuts
    this.register("C-c", "Cancel/quit", () => this.cancel(), "tools");
    this.register("C-z", "Suspend", () => this.suspend(), "tools");
    this.register("F1", "Help", () => this.showHelp(), "tools");
    this.register("F2", "Edit message", () => this.editMessage(), "tools");
    this.register("F3", "Copy message", () => this.copyMessage(), "tools");
    this.register("F5", "Re-run", () => this.rerun(), "tools");
  }

  register(key: string, description: string, action: ShortcutAction, category?: "editing" | "navigation" | "session" | "search" | "tools") {
    this.shortcuts.set(key, { key, description, action, category });
  }

  handleKeyPress(ch: string, key: blessed.Keys): boolean {
    // Build key identifier
    let keyId = "";

    if (key.ctrl) {
      keyId += "C-";
    }

    if (key.meta) {
      keyId += "M-";
    }

    if (key.shift) {
      keyId += "S-";
    }

    if (key.name) {
      keyId += key.name;
    } else if (ch && ch.length === 1) {
      keyId += ch;
    }

    // Check for exact match
    if (this.shortcuts.has(keyId)) {
      const shortcut = this.shortcuts.get(keyId)!;
      shortcut.action();
      return true;
    }

    // Check for multi-key sequences (e.g., C-x followed by r)
    const sequence = (globalThis as { keySequence?: string[] }).keySequence || [];
    sequence.push(keyId);

    // Check for sequences
    const fullSequence = sequence.join(" ");
    for (const [key, shortcut] of this.shortcuts) {
      if (key.startsWith(fullSequence)) {
        if (key === fullSequence) {
          // Exact match - execute and clear
          sequence.length = 0;
          shortcut.action();
          return true;
        } else {
          // Partial match - wait for next key
          (globalThis as { keySequence?: string[] }).keySequence = sequence;
          return true;
        }
      }
    }

    // No match - clear sequence
    sequence.length = 0;
    (globalThis as { keySequence?: string[] }).keySequence = sequence;

    return false;
  }

  // Editing actions
  private killToEOL() {
    // Emit event for app to handle
    this.screen.emit("kill-to-eol");
  }

  private killToBOL() {
    this.screen.emit("kill-to-bol");
  }

  private deletePreviousWord() {
    this.screen.emit("delete-previous-word");
  }

  private yank() {
    const text = this.killRing.pop();
    if (text) {
      this.screen.emit("yank", text);
    }
  }

  private forwardWord() {
    this.screen.emit("forward-word");
  }

  private backwardWord() {
    this.screen.emit("backward-word");
  }

  private deleteForward() {
    this.screen.emit("delete-forward");
  }

  private deleteBackward() {
    this.screen.emit("delete-backward");
  }

  private transposeChars() {
    this.screen.emit("transpose-chars");
  }

  // Navigation actions
  private jumpToStart() {
    this.screen.emit("jump-start");
  }

  private jumpToEnd() {
    this.screen.emit("jump-end");
  }

  private pageDown() {
    this.screen.emit("page-down");
  }

  private pageUp() {
    this.screen.emit("page-up");
  }

  private clearScreen() {
    this.screen.emit("clear-screen");
  }

  // Session actions
  private toggleMultiLine() {
    this.screen.emit("toggle-multiline");
  }

  private showQuickActions() {
    this.screen.emit("quick-actions");
  }

  private saveSession() {
    this.screen.emit("save-session");
  }

  private reverseSearch() {
    this.screen.emit("reverse-search");
  }

  private recordMacro() {
    this.screen.emit("record-macro");
  }

  private executeMacro() {
    this.screen.emit("execute-macro");
  }

  // Search actions
  private searchChat() {
    this.screen.emit("search-chat");
  }

  private nextSearchResult() {
    this.screen.emit("next-search");
  }

  private prevSearchResult() {
    this.screen.emit("prev-search");
  }

  // Tool actions
  private cancel() {
    this.screen.emit("cancel");
  }

  private suspend() {
    this.screen.emit("suspend");
  }

  private showHelp() {
    this.toggleHelp();
  }

  private editMessage() {
    this.screen.emit("edit-message");
  }

  private copyMessage() {
    this.screen.emit("copy-message");
  }

  private rerun() {
    this.screen.emit("rerun");
  }

  // Help modal
  private toggleHelp() {
    if (this.helpModal && this.helpModal.visible) {
      this.helpModal.hide();
      this.screen.render();
      return;
    }

    this.showHelpModal();
  }

  private showHelpModal() {
    const c = themeEngine.getBlessedColors();

    this.helpModal = blessed.box({
      parent: this.screen,
      left: "center",
      top: "center",
      width: "70%",
      height: "70%",
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    const title = blessed.text({
      parent: this.helpModal,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 1,
      content: `{${c.accent}-fg}{bold}Keyboard Shortcuts{/} {${c.textTertiary}-fg}(Esc to close){/}`,
      tags: true,
    });

    const content = this.formatHelpContent();

    const list = blessed.text({
      parent: this.helpModal,
      top: 2,
      left: 1,
      width: "100%-2",
      height: "100%-4",
      content,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      scrollbar: {
        ch: " ",
        style: { bg: c.border },
      },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
      },
    });

    this.helpModal.key(["escape"], () => {
      this.helpModal!.hide();
      this.screen.render();
    });

    this.helpModal.show();
    this.helpModal.setFront();
    this.screen.render();
  }

  private formatHelpContent(): string {
    const c = themeEngine.getBlessedColors();
    const categories: Record<string, KeyboardShortcut[]> = {
      editing: [],
      navigation: [],
      session: [],
      search: [],
      tools: [],
    };

    for (const shortcut of this.shortcuts.values()) {
      if (shortcut.category) {
        categories[shortcut.category].push(shortcut);
      }
    }

    let result = "";
    const titles = {
      editing: `{${c.cyan}-fg}{bold}Editing{/}`,
      navigation: `{${c.lime}-fg}{bold}Navigation{/}`,
      session: `{${c.magenta}-fg}{bold}Session{/}`,
      search: `{${c.yellow}-fg}{fg}{bold}Search{/}`,
      tools: `{${c.amber}-fg}{bold}Tools{/}`,
    };

    for (const [cat, shortcuts] of Object.entries(categories)) {
      if (shortcuts.length === 0) continue;

      result += `${titles[cat as keyof typeof titles]}\n`;
      result += `{${c.border}-fg}${"─".repeat(60)}{/}\n`;

      for (const shortcut of shortcuts) {
        const keyDisplay = this.formatKey(shortcut.key);
        result += `  {${c.textPrimary}-fg}${keyDisplay.padEnd(20)}{/} {${c.textSecondary}-fg}${shortcut.description}{/}\n`;
      }

      result += "\n";
    }

    return result;
  }

  private formatKey(key: string): string {
    const c = themeEngine.getBlessedColors();
    return key
      .replace(/C-/g, `{${c.accent}-fg}Ctrl+{/}`)
      .replace(/M-/g, `{${c.accent}-fg}Alt+{/}`)
      .replace(/S-/g, `{${c.accent}-fg}Shift+{/}`)
      .replace(/F(\d+)/g, `{${c.accent}-fg}F$1{/}`);
  }

  addToKillRing(text: string) {
    this.killRing.push(text);
    if (this.killRing.length > 10) {
      this.killRing.shift();
    }
  }
}