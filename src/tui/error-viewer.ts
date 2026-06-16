/**
 * Expandable error messages with syntax highlighting and auto-fix
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { renderMarkdown } from "./render-markdown.js";

export interface ErrorDetail {
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  col?: number;
  code?: string;
}

export class ErrorViewer {
  private overlay?: blessed.Widgets.BoxElement;
  private content?: blessed.Widgets.BoxElement;
  private actions?: blessed.Widgets.BoxElement;
  private currentError: ErrorDetail | null = null;

  constructor(private parent: blessed.Widgets.Screen) {}

  showError(detail: ErrorDetail) {
    this.currentError = detail;
    this.createUI();
    this.renderError();
    this.overlay!.show();
    this.overlay!.setFront();
    this.parent.render();
  }

  hideError() {
    if (this.overlay) {
      this.overlay.hide();
      this.parent.render();
    }
  }

  private createUI() {
    if (this.overlay) return;

    const c = themeEngine.getBlessedColors();

    // Full-screen overlay
    this.overlay = blessed.box({
      parent: this.parent,
      left: "center",
      top: "center",
      width: "80%",
      height: "70%",
      hidden: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.error },
      },
    });

    // Title bar
    const title = blessed.box({
      parent: this.overlay,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: `{${c.error}-fg}{bold}✗ Error{/} {${c.textTertiary}-fg}Press Esc to close{/}`,
      tags: true,
      style: { bg: c.bgSecondary },
    });

    // Content area
    this.content = blessed.box({
      parent: this.overlay,
      top: 2,
      left: 1,
      width: "100%-2",
      height: "100%-4",
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

    // Actions bar
    this.actions = blessed.box({
      parent: this.overlay,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: "",
      tags: true,
      style: { bg: c.bgSecondary },
    });

    // Key bindings
    this.overlay.key(["escape"], () => this.hideError());
    this.overlay.key(["r"], () => this.retry());
    this.overlay.key(["f"], () => this.autoFix());
    this.overlay.key(["c"], () => this.copyError());
  }

  private renderError() {
    if (!this.currentError || !this.content) return;

    const c = themeEngine.getBlessedColors();
    let content = "";

    // Error message
    content += `{${c.error}-fg}{bold}${this.currentError.message}{/}\n\n`;

    // File location
    if (this.currentError.file) {
      const location = `${this.currentError.file}` +
        (this.currentError.line ? `:${this.currentError.line}` : "") +
        (this.currentError.col ? `:${this.currentError.col}` : "");
      content += `{${c.textSecondary}-fg}Location: {${c.cyan}-fg}${location}{/}\n\n`;
    }

    // Code snippet (if available)
    if (this.currentError.code) {
      content += `{${c.cyan}-fg}Code:{/}\n`;
      content += this.renderCodeSnippet(this.currentError.code, this.currentError.line);
      content += "\n";
    }

    // Stack trace
    if (this.currentError.stack) {
      content += `{${c.cyan}-fg}Stack Trace:{/}\n`;
      content += this.renderStacktrace(this.currentError.stack);
    }

    this.content.setContent(content);

    // Render actions
    this.renderActions();
  }

  private renderCodeSnippet(code: string, errorLine?: number): string {
    const c = themeEngine.getBlessedColors();
    const lines = code.split("\n").slice(0, 10); // Max 10 lines

    return lines.map((line, i) => {
      const lineNum = (errorLine || 0) - 5 + i + 1;
      const isErrorLine = lineNum === errorLine;
      const prefix = isErrorLine ? `{${c.error}-fg}▶{/}` : " ";
      const lineContent = isErrorLine ?
        `{${c.error}-bg}${this.esc(line)}{/}` :
        this.esc(line);
      return `{${c.textTertiary}-fg}${String(lineNum).padStart(4)}{/} ${prefix} ${lineContent}`;
    }).join("\n");
  }

  private renderStacktrace(stack: string): string {
    const c = themeEngine.getBlessedColors();
    const lines = stack.split("\n");

    return lines.map((line) => {
      // Highlight file:line patterns
      return line.replace(/([^:]+):(\d+):(\d+)/, (match, file, line, col) =>
        `{${c.cyan}-fg}${file}:{${c.textPrimary}-fg}${line}:{${c.textSecondary}-fg}${col}{/}`
      );
    }).join("\n");
  }

  private renderActions() {
    if (!this.actions) return;

    const c = themeEngine.getBlessedColors();
    this.actions.setContent(
      `  [{${c.lime}-fg}R{/}etry] ` +
      `[{${c.cyan}-fg}F{/}ix] ` +
      `[{${c.textPrimary}-fg}C{/}opy] ` +
      `[{${c.textSecondary}-fg}Esc{/} Close]`
    );
  }

  private retry() {
    this.parent.emit("error-retry");
    this.hideError();
  }

  private autoFix() {
    if (!this.currentError) return;
    this.parent.emit("error-autofix", this.currentError);
    this.hideError();
  }

  private copyError() {
    if (!this.currentError) return;
    const text = [
      this.currentError.message,
      this.currentError.file && `File: ${this.currentError.file}`,
      this.currentError.line && `Line: ${this.currentError.line}`,
      this.currentError.stack,
    ].filter(Boolean).join("\n");

    // Copy to clipboard (terminal-specific)
    try {
      process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
      this.parent.emit("error-copied");
    } catch (err) {
      // Silent fail
    }

    this.hideError();
  }

  private esc(s: string): string {
    return s.replace(/[{}]/g, (ch) => (ch === "{" ? "{open}" : "{close}"));
  }
}