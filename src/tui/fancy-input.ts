/**
 * Fancy Chat Input Box with animations, visual polish, and rich features
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export interface FancyInputOptions {
  parent: blessed.Widgets.Screen;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  maxHeight?: number;
}

export class FancyChatInput {
  private container?: blessed.Widgets.BoxElement;
  private input?: blessed.Widgets.BoxElement;
  private leftBorder?: blessed.Widgets.BoxElement;
  private rightBorder?: blessed.Widgets.BoxElement;
  private prompt?: blessed.Widgets.BoxElement;
  private suggestions?: blessed.Widgets.BoxElement;
  private buffer = "";
  private cursor = 0;
  private active = true;
  private suggestionIndex = 0;
  private suggestionsList: string[] = [];
  private showingSuggestions = false;

  constructor(private options: FancyInputOptions) {
    this.createUI();
    this.setupAnimations();
  }

  private createUI() {
    const c = themeEngine.getBlessedColors();

    // Main container with rounded corners effect
    this.container = blessed.box({
      parent: this.options.parent,
      left: 0,
      width: "100%",
      bottom: 0,
      height: this.options.maxHeight || 5,
      style: {
        bg: c.bgSecondary,
        fg: c.textPrimary,
      },
    });

    // Decorative border - left side (avatar/glow effect)
    this.leftBorder = blessed.box({
      parent: this.container,
      left: 0,
      top: 0,
      width: 1,
      height: "100%",
      style: {
        bg: c.accent || c.cyan,
      },
    });

    // Prompt indicator with animated glow
    this.prompt = blessed.box({
      parent: this.container,
      left: 1,
      top: 1,
      width: 4,
      height: 1,
      content: `{${c.accent}-fg}{bold}❯{/}`,
      tags: true,
      style: { bg: c.bgSecondary },
    });

    // Main input area
    this.input = blessed.box({
      parent: this.container,
      left: 5,
      top: 1,
      width: "100%-7",
      height: 1,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      style: {
        bg: c.bgSecondary,
        fg: c.textPrimary,
      },
    });

    // Decorative border - right side
    this.rightBorder = blessed.box({
      parent: this.container,
      right: 0,
      top: 0,
      width: 1,
      height: "100%",
      style: {
        bg: c.accent || c.cyan,
      },
    });

    // Suggestions dropdown (hidden by default)
    this.suggestions = blessed.box({
      parent: this.options.parent,
      left: 6,
      bottom: 5,
      width: "40%",
      height: 6,
      hidden: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    this.render();
  }

  private setupAnimations() {
    // Pulse animation for the prompt
    let pulseState = 0;
    setInterval(() => {
      if (!this.active) return;

      const c = themeEngine.getBlessedColors();
      const colors = [c.accent || c.cyan, c.lime, c.magenta];
      pulseState = (pulseState + 1) % colors.length;

      this.prompt!.setContent(`{${colors[pulseState]}-fg}{bold}❯{/}`);
      this.options.parent.render();
    }, 1000);
  }

  insertText(text: string) {
    const before = this.buffer.slice(0, this.cursor);
    const after = this.buffer.slice(this.cursor);
    this.buffer = before + text + after;
    this.cursor += text.length;
    this.render();
  }

  backspace() {
    if (this.cursor > 0) {
      const before = this.buffer.slice(0, this.cursor - 1);
      const after = this.buffer.slice(this.cursor);
      this.buffer = before + after;
      this.cursor--;
      this.render();
    }
  }

  deleteForward() {
    if (this.cursor < this.buffer.length) {
      const before = this.buffer.slice(0, this.cursor);
      const after = this.buffer.slice(this.cursor + 1);
      this.buffer = before + after;
      this.render();
    }
  }

  moveLeft() {
    if (this.cursor > 0) {
      this.cursor--;
      this.render();
    }
  }

  moveRight() {
    if (this.cursor < this.buffer.length) {
      this.cursor++;
      this.render();
    }
  }

  moveToStart() {
    this.cursor = 0;
    this.render();
  }

  moveToEnd() {
    this.cursor = this.buffer.length;
    this.render();
  }

  deleteWord() {
    // Delete word before cursor
    const before = this.buffer.slice(0, this.cursor);
    const after = this.buffer.slice(this.cursor);

    const wordBoundary = before.search(/\S+$/);
    if (wordBoundary !== -1) {
      this.buffer = before.slice(0, wordBoundary) + after;
      this.cursor = wordBoundary;
      this.render();
    }
  }

  submit() {
    const text = this.buffer.trim();
    this.buffer = "";
    this.cursor = 0;
    this.render();

    if (text) {
      this.options.onSubmit(text);
    }
  }

  clear() {
    this.buffer = "";
    this.cursor = 0;
    this.render();
  }

  private render() {
    const c = themeEngine.getBlessedColors();

    if (this.buffer.length === 0) {
      this.input!.setContent(`{${c.textTertiary}-fg}${this.options.placeholder || "Type your message..."}{/}`);
    } else {
      const maxChars = (this.options.parent.width as number) - 10;
      const visible = this.getVisibleWindow(maxChars);
      this.input!.setContent(visible);
    }

    this.options.parent.render();
  }

  private getVisibleWindow(maxChars: number): string {
    const before = this.buffer.slice(0, this.cursor);
    const atChar = this.cursor < this.buffer.length ? this.buffer[this.cursor] : " ";
    const after = this.cursor < this.buffer.length ? this.buffer.slice(this.cursor + 1) : "";

    const beforeEsc = this.esc(before);
    const atCharEsc = this.esc(atChar);
    const afterEsc = this.esc(after.slice(0, maxChars - beforeEsc.length - 1));

    return `${beforeEsc}{inverse}${atCharEsc}{/inverse}${afterEsc}`;
  }

  showSuggestions(items: string[]) {
    this.suggestionsList = items;
    this.suggestionIndex = 0;
    this.showingSuggestions = true;
    this.suggestions!.show();
    this.renderSuggestions();
  }

  private renderSuggestions() {
    if (!this.showingSuggestions) return;

    const c = themeEngine.getBlessedColors();
    const items = this.suggestionsList.map((item, i) => {
      const prefix = i === this.suggestionIndex ? "▶ " : "  ";
      const color = i === this.suggestionIndex ? c.accent : c.textPrimary;
      return `{${color}-fg}${prefix}${item}{/}`;
    });

    this.suggestions!.setContent(items.join("\n"));
    this.options.parent.render();
  }

  selectSuggestion() {
    if (!this.showingSuggestions || this.suggestionsList.length === 0) return;

    const selected = this.suggestionsList[this.suggestionIndex];
    this.insertText(selected);
    this.hideSuggestions();
  }

  moveSuggestion(dir: number) {
    if (!this.showingSuggestions) return;

    this.suggestionIndex =
      (this.suggestionIndex + dir + this.suggestionsList.length) % this.suggestionsList.length;
    this.renderSuggestions();
  }

  hideSuggestions() {
    this.showingSuggestions = false;
    this.suggestions!.hide();
    this.options.parent.render();
  }

  focus() {
    this.active = true;
    this.container!.setFront();
  }

  blur() {
    this.active = false;
  }

  hide() {
    this.active = false;
    this.container!.hide();
  }

  show() {
    this.active = true;
    this.container!.show();
  }

  getBuffer(): string {
    return this.buffer;
  }

  getCursor(): number {
    return this.cursor;
  }

  setBuffer(text: string, cursor?: number) {
    this.buffer = text;
    this.cursor = cursor !== undefined ? cursor : text.length;
    this.render();
  }

  private esc(s: string): string {
    return s.replace(/[{}]/g, (ch) => (ch === "{" ? "{open}" : "{close}"));
  }

  destroy() {
    if (this.container) {
      this.container.destroy();
      this.container = undefined;
    }
  }
}

/**
 * Typing indicator animation
 */
export class TypingIndicator {
  private box?: blessed.Widgets.BoxElement;
  private active = false;
  private frame = 0;
  private interval?: ReturnType<typeof setInterval>;

  constructor(private parent: blessed.Widgets.Screen) {}

  show(message = "Sentinel is thinking") {
    if (this.active) return;

    const c = themeEngine.getBlessedColors();

    this.box = blessed.box({
      parent: this.parent,
      left: 1,
      bottom: 5,
      width: "100%-2",
      height: 1,
      content: "",
      tags: true,
      style: { bg: c.bgSecondary },
    });

    this.active = true;
    this.frame = 0;

    this.interval = setInterval(() => {
      if (!this.active) return;

      const dots = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[this.frame % 10];
      this.box!.setContent(`{${c.cyan}-fg}${dots}{/} {${c.textTertiary}-fg}${message}...{/}`);
      this.frame++;
      this.parent.render();
    }, 100);
  }

  hide() {
    this.active = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    if (this.box) {
      this.box.destroy();
      this.box = undefined;
    }

    this.parent.render();
  }

  updateMessage(message: string) {
    if (this.box && this.active) {
      const c = themeEngine.getBlessedColors();
      const dots = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[this.frame % 10];
      this.box.setContent(`{${c.cyan}-fg}${dots}{/} {${c.textTertiary}-fg}${message}...{/}`);
      this.parent.render();
    }
  }
}