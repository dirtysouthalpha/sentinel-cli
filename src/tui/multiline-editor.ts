/**
 * Multi-line input editor with rich editing features
 * Supports Ctrl+O to toggle, Ctrl+Enter to submit
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export interface MultiLineEditorOptions {
  parent: blessed.Widgets.Screen;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export class MultiLineEditor {
  private overlay!: blessed.Widgets.BoxElement;
  private editor!: blessed.Widgets.TextareaElement;
  private status!: blessed.Widgets.BoxElement;
  private active = false;

  constructor(private options: MultiLineEditorOptions) {
    this.createUI();
    this.setupKeys();
  }

  private createUI() {
    const c = themeEngine.getBlessedColors();

    // Full-screen overlay
    this.overlay = blessed.box({
      parent: this.options.parent,
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      hidden: true,
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
      },
    });

    // Title bar
    const title = blessed.box({
      parent: this.overlay,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: `{${c.cyan}-fg}{bold}Multi-Line Editor{/} {${c.textTertiary}-fg}Ctrl+Enter: Submit · Esc: Cancel{/}`,
      tags: true,
      style: { bg: c.bgSecondary },
    });

    // Text editor
    this.editor = blessed.textarea({
      parent: this.overlay,
      top: 2,
      left: 1,
      width: "100%-2",
      height: "100%-4",
      inputOnFocus: true,
      keys: true,
      mouse: true,
      scrollable: true,
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        focus: {
          bg: c.bgPrimary,
          fg: c.textPrimary,
        },
      },
    });

    // Status bar
    this.status = blessed.box({
      parent: this.overlay,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: "",
      tags: true,
      style: { bg: c.bgSecondary },
    });

    // Update status on keypress
    this.editor.on("keypress", () => this.updateStatus());
    this.editor.key(["C-enter"], () => this.submit());
    this.editor.key(["escape"], () => this.hide());
  }

  private setupKeys() {
    // Additional key bindings
    this.editor.key(["C-a"], () => {
      this.editor.setScrollPerc(0);
    });

    this.editor.key(["C-e"], () => {
      this.editor.setScrollPerc(100);
    });

    this.editor.key(["C-k"], () => {
      const line = this.editor.value.split("\n");
      const currentLine = this.editor.getCursor().y;
      const afterCursor = line[currentLine].slice(this.editor.getCursor().x);
      line[currentLine] = line[currentLine].slice(0, this.editor.getCursor().x);
      this.editor.value = line.join("\n");
      (globalThis as { killRing?: string[] }).killRing = (globalThis as { killRing?: string[] }).killRing || [];
      (globalThis as { killRing?: string[] }).killRing.push(afterCursor);
      this.updateStatus();
    });

    this.editor.key(["C-y"], () => {
      const killRing = (globalThis as { killRing?: string[] }).killRing || [];
      if (killRing.length > 0) {
        const text = killRing.pop()!;
        const cursor = this.editor.getCursor();
        const lines = this.editor.value.split("\n");
        lines[cursor.y] = lines[cursor.y].slice(0, cursor.x) + text + lines[cursor.y].slice(cursor.x);
        this.editor.value = lines.join("\n");
        this.updateStatus();
      }
    });

    this.editor.key(["C-w"], () => {
      const cursor = this.editor.getCursor();
      const lines = this.editor.value.split("\n");
      const line = lines[cursor.y];
      const beforeCursor = line.slice(0, cursor.x);
      const afterCursor = line.slice(cursor.x);

      // Delete word before cursor
      const words = beforeCursor.split(/\s+/);
      const lastWord = words.pop() || "";
      lines[cursor.y] = words.join(" ") + (words.length ? " " : "") + afterCursor;

      this.editor.value = lines.join("\n");
      this.updateStatus();
    });
  }

  private updateStatus() {
    const c = themeEngine.getBlessedColors();
    const text = this.editor.value;
    const lines = text.split("\n");
    const cursor = this.editor.getCursor();

    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const charCount = text.length;
    const lineNum = cursor.y + 1;
    const colNum = cursor.x + 1;

    this.status.setContent(
      `{${c.textSecondary}-fg}Lines: ${lines.length} · Words: ${wordCount} · Chars: ${charCount} · Line ${lineNum}, Col ${colNum}{/}`
    );
  }

  private submit() {
    const text = this.editor.value.trim();
    this.hide();
    if (text) {
      this.options.onSubmit(text);
    }
  }

  show(initialText = "") {
    this.active = true;
    this.editor.value = initialText;
    this.overlay.show();
    this.editor.setFront();
    this.editor.focus();
    this.updateStatus();
    this.options.parent.render();
  }

  hide() {
    this.active = false;
    this.overlay.hide();
    this.options.parent.render();
    this.options.onCancel();
  }

  toggle() {
    if (this.active) {
      this.hide();
    } else {
      this.show();
    }
  }

  isActive(): boolean {
    return this.active;
  }
}