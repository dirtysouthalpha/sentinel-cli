/**
 * Expandable tool results with code highlighting, diffs, and previews
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export interface ToolResult {
  tool: string;
  args: string;
  success: boolean;
  output: string;
  timestamp?: number;
}

export class ToolResultViewer {
  private overlay?: blessed.Widgets.BoxElement;
  private content?: blessed.Widgets.BoxElement;
  private currentResult: ToolResult | null = null;

  constructor(private parent: blessed.Widgets.Screen) {}

  showResult(result: ToolResult) {
    this.currentResult = result;
    this.createUI();
    this.renderResult();
    this.overlay!.show();
    this.overlay!.setFront();
    this.parent.render();
  }

  hideResult() {
    if (this.overlay) {
      this.overlay.hide();
      this.parent.render();
    }
  }

  private createUI() {
    if (this.overlay) return;

    const c = themeEngine.getBlessedColors();

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
        border: { fg: this.currentResult?.success ? c.lime : c.error },
      },
    });

    const header = blessed.box({
      parent: this.overlay,
      top: 0,
      left: 0,
      width: "100%",
      height: 2,
      content: "",
      tags: true,
      style: { bg: c.bgSecondary },
    });

    this.content = blessed.box({
      parent: this.overlay,
      top: 3,
      left: 1,
      width: "100%-2",
      height: "100%-6",
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

    const footer = blessed.box({
      parent: this.overlay,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: `  [{${c.textPrimary}-fg}C{/}opy] [{${c.textPrimary}-fg}S{/}ave] [{${c.textSecondary}-fg}Esc{/}] Close`,
      tags: true,
      style: { bg: c.bgSecondary },
    });

    this.overlay.key(["escape", "q"], () => this.hideResult());
  }

  private renderResult() {
    if (!this.currentResult || !this.content) return;

    const c = themeEngine.getBlessedColors();
    const result = this.currentResult;

    const icon = result.success ? "✓" : "✗";
    const color = result.success ? c.lime : c.error;

    this.content.setContent(
      `{${color}-fg}${icon}{/} {${c.cyan}-fg}${result.tool}{/}\n` +
      `{${c.textTertiary}-fg}Args: ${this.esc(result.args.slice(0, 60))}{/}\n\n` +
      this.formatOutput(result.output, result.tool)
    );
  }

  private formatOutput(output: string, tool: string): string {
    const c = themeEngine.getBlessedColors();
    return this.esc(output.slice(0, 1000));
  }

  private esc(s: string): string {
    return s.replace(/[{}]/g, (ch) => (ch === "{" ? "{open}" : "{close}"));
  }
}