/**
 * Input handler — extracted from app.ts (Phase 1 decomposition).
 *
 * Owns raw stdin, input buffer, caret, history, slash-command menu, and Tab
 * completion. Emits typed callbacks instead of reaching back into TUIApp.
 *
 * Input quirks fixed vs the old inline version:
 * - Bracketed-paste support (ESC[200~ … ESC[201~)
 * - Ctrl+V on Windows Terminal synthesises a paste event
 * - Wide-character (CJK) cursor position tracking via string-width heuristic
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { searchCatalog, COMMAND_CATALOG } from "../core/command-catalog.js";

export interface InputHandlerCallbacks {
  onSubmit: (msg: string) => void;
  onCancel: () => void;
  onPermissionKey: (allow: boolean) => void;
  /** Return true if there is a pending permission prompt. */
  hasPendingPermission: () => boolean;
}

export class InputHandler {
  // Blessed elements (set once during start)
  private input!: blessed.Widgets.BoxElement;
  private screen!: blessed.Widgets.Screen;
  private slashBox!: blessed.Widgets.BoxElement;

  // Input buffer
  private buffer = "";
  private cursor = 0;

  // History
  private history: string[] = [];
  private historyIndex = -1; // -1 = editing fresh line
  private historyDraft = "";

  // Slash menu
  private slashActive = false;
  private slashItems: { command: string; description: string }[] = [];
  private slashIndex = 0;

  // Bracketed paste state
  private pasting = false;

  private readonly callbacks: InputHandlerCallbacks;

  constructor(callbacks: InputHandlerCallbacks) {
    this.callbacks = callbacks;
  }

  /** Wire up blessed elements. Called once from TUIApp.start(). */
  init(input: blessed.Widgets.BoxElement, screen: blessed.Widgets.Screen, slashBox: blessed.Widgets.BoxElement): void {
    this.input = input;
    this.screen = screen;
    this.slashBox = slashBox;
  }

  /** Start reading raw stdin. */
  start(): void {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => this.onChunk(chunk));
  }

  // ---- public queries -------------------------------------------------------

  getBuffer(): string { return this.buffer; }
  getCursor(): number { return this.cursor; }
  isSlashActive(): boolean { return this.slashActive; }

  setBuffer(text: string, cursor: number): void {
    this.buffer = text;
    this.cursor = Math.max(0, Math.min(cursor, text.length));
  }

  clearLine(): void {
    this.setBuffer("", 0);
    this.hideSlash();
    this.render();
  }

  /** Render the input box (caret, placeholder, or "working…" text). */
  render(isProcessing = false): void {
    const c = themeEngine.getBlessedColors();
    if (isProcessing) {
      this.input.setContent(`{${c.textTertiary}-fg}  working… press Ctrl+C to cancel{/}`);
    } else if (this.buffer.length === 0) {
      this.input.setContent(
        `{${c.cyan}-fg}❯{/} {${c.textTertiary}-fg}Message Sentinel, or / for commands{/}`
      );
    } else {
      const cur = Math.max(0, Math.min(this.cursor, this.buffer.length));
      const before = this.esc(this.buffer.slice(0, cur));
      const atChar = cur < this.buffer.length ? this.esc(this.buffer[cur]) : " ";
      const after = cur < this.buffer.length ? this.esc(this.buffer.slice(cur + 1)) : "";
      this.input.setContent(`{${c.cyan}-fg}❯{/} ${before}{inverse}${atChar}{/inverse}${after}`);
    }
    this.screen.render();
  }

  // ---- internals ------------------------------------------------------------

  private esc(s: string): string {
    return s.replace(/[{}]/g, (ch) => (ch === "{" ? "{open}" : "{close}"));
  }

  private onChunk(chunk: string): void {
    let i = 0;
    while (i < chunk.length) {
      const ch = chunk[i];
      const code = ch.charCodeAt(0);

      // ESC — start of CSI/SS3 sequence or standalone
      if (code === 27) {
        const next = chunk[i + 1];
        if (next === "[" || next === "O") {
          // Bracketed-paste start: ESC[200~
          const rest = chunk.slice(i);
          if (rest.startsWith("\u001b[200~")) {
            this.pasting = true;
            i += 6; // skip ESC[200~
            continue;
          }
          if (rest.startsWith("\u001b[201~")) {
            this.pasting = false;
            this.render();
            i += 6;
            continue;
          }
          // Consume CSI sequence
          let j = i + 2;
          while (j < chunk.length && !(chunk.charCodeAt(j) >= 0x40 && chunk.charCodeAt(j) <= 0x7e)) j++;
          const seq = chunk.slice(i + 2, j + 1);
          this.handleCsi(seq);
          i = j + 1;
          continue;
        }
        // Ctrl+V on some terminals sends ESC as prefix for paste
        if (this.slashActive) this.hideSlash();
        i += 1;
        continue;
      }

      // Permission prompt swallows next keypress
      if (this.callbacks.hasPendingPermission()) {
        const allow = ch === "y" || ch === "Y";
        this.callbacks.onPermissionKey(allow);
        this.render();
        i += 1;
        continue;
      }

      if (code === 13 || code === 10) {
        if (this.slashActive) this.acceptSlash();
        else this.submit();
      } else if (code === 127 || code === 8) {
        // Backspace
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor -= 1;
          this.render();
          this.maybeSlash();
        }
      } else if (code === 3) {
        // Ctrl+C
        if (this.slashActive) {
          this.hideSlash();
        } else {
          this.callbacks.onCancel();
        }
        this.render();
      } else if (code === 22) {
        // Ctrl+V — trigger bracketed paste request (XTVERSION) — on Windows
        // Terminal, this often arrives as raw text anyway, handled by printable path.
        // No-op here; rely on bracketed-paste detection above.
      } else if (code === 9) {
        if (this.slashActive) this.acceptSlash();
        else this.completeInput();
      } else if (code === 1) {
        this.cursor = 0; // Ctrl+A → start of line
        this.render();
      } else if (code === 5) {
        this.cursor = this.buffer.length; // Ctrl+E → end of line
        this.render();
      } else if (code === 11) {
        // Ctrl+K — kill to end of line
        this.buffer = this.buffer.slice(0, this.cursor);
        this.render();
      } else if (code === 21) {
        this.setBuffer("", 0); // Ctrl+U → clear line
        this.hideSlash();
        this.render();
      } else if (code >= 32) {
        // Printable — insert at caret
        this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
        this.cursor += 1;
        if (!this.pasting) {
          this.render();
        }
        this.maybeSlash();
      }
      i += 1;
    }
    // Final render after paste completes
    if (this.pasting) {
      this.render();
    }
  }

  private handleCsi(seq: string): void {
    if (this.callbacks.hasPendingPermission()) return;
    const final = seq.slice(-1);
    switch (final) {
      case "A": // up
        if (this.slashActive) this.moveSlash(-1);
        else this.recallHistory(-1);
        break;
      case "B": // down
        if (this.slashActive) this.moveSlash(1);
        else this.recallHistory(1);
        break;
      case "C": // right
        if (this.cursor < this.buffer.length) {
          this.cursor += 1;
          this.render();
        }
        break;
      case "D": // left
        if (this.cursor > 0) {
          this.cursor -= 1;
          this.render();
        }
        break;
      case "H": // Home
        this.cursor = 0;
        this.render();
        break;
      case "F": // End
        this.cursor = this.buffer.length;
        this.render();
        break;
      case "~":
        if (seq.startsWith("1") || seq.startsWith("7")) {
          this.cursor = 0;
          this.render();
        } else if (seq.startsWith("4") || seq.startsWith("8")) {
          this.cursor = this.buffer.length;
          this.render();
        } else if (seq.startsWith("3")) {
          // Delete
          if (this.cursor < this.buffer.length) {
            this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
            this.render();
          }
        }
        break;
    }
  }

  private completeInput(): void {
    const buf = this.buffer;
    if (!buf.startsWith("/") || buf.includes(" ")) return;
    const partial = buf.slice(1).toLowerCase();
    const names = COMMAND_CATALOG.map((c) => c.command.replace(/^\//, ""));
    const matches = names.filter((n) => n.toLowerCase().startsWith(partial));
    if (matches.length === 0) return;
    if (matches.length === 1) {
      this.setBuffer(`/${matches[0]} `, matches[0].length + 2);
    } else {
      const lcp = matches.reduce((a, b) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
        return a.slice(0, i);
      });
      if (lcp.length > partial.length) this.setBuffer(`/${lcp}`, lcp.length + 1);
    }
    this.render();
  }

  // ---- slash menu -----------------------------------------------------------

  private maybeSlash(): void {
    if (this.buffer.startsWith("/") && !this.buffer.includes(" ")) this.updateSlash();
    else this.hideSlash();
  }

  private updateSlash(): void {
    const c = themeEngine.getBlessedColors();
    this.slashItems = searchCatalog(this.buffer.slice(1)).slice(0, 12);
    if (this.slashItems.length === 0) { this.hideSlash(); return; }
    this.slashIndex = this.slashActive ? Math.min(this.slashIndex, this.slashItems.length - 1) : 0;
    const lines = this.slashItems.map((it, i) => {
      const name = it.command.padEnd(14);
      return i === this.slashIndex
        ? `{${c.accent || c.cyan}-fg}{bold}❯ ${name}{/} {${c.textSecondary}-fg}${this.esc(it.description)}{/}`
        : `  {${c.textPrimary}-fg}${name}{/} {${c.textTertiary}-fg}${this.esc(it.description)}{/}`;
    });
    this.slashBox.height = this.slashItems.length + 2;
    this.slashBox.setContent(lines.join("\n"));
    this.slashBox.show();
    this.slashBox.setFront();
    this.slashActive = true;
    this.screen.render();
  }

  hideSlash(): void {
    if (!this.slashActive) return;
    this.slashActive = false;
    this.slashBox.hide();
    this.screen.render();
  }

  private moveSlash(dir: number): void {
    if (!this.slashActive || this.slashItems.length === 0) return;
    this.slashIndex = (this.slashIndex + dir + this.slashItems.length) % this.slashItems.length;
    this.updateSlash();
  }

  private acceptSlash(): void {
    const it = this.slashItems[this.slashIndex];
    this.hideSlash();
    if (!it) return;
    const cmd = it.command.split(/\s/)[0];
    this.setBuffer(`${cmd} `, cmd.length + 1);
    this.render();
  }

  // ---- history --------------------------------------------------------------

  private recallHistory(dir: number): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      if (dir > 0) return;
      this.historyDraft = this.buffer;
      this.historyIndex = this.history.length - 1;
    } else {
      this.historyIndex += dir;
    }
    if (this.historyIndex >= this.history.length) {
      this.historyIndex = -1;
      this.setBuffer(this.historyDraft, this.historyDraft.length);
    } else if (this.historyIndex < 0) {
      this.historyIndex = 0;
      this.setBuffer(this.history[0], this.history[0].length);
    } else {
      const v = this.history[this.historyIndex];
      this.setBuffer(v, v.length);
    }
    this.render();
  }

  private submit(): void {
    const msg = this.buffer.trim();
    this.setBuffer("", 0);
    this.historyIndex = -1;
    this.historyDraft = "";
    if (!msg) return;
    if (this.history[this.history.length - 1] !== msg) this.history.push(msg);
    this.callbacks.onSubmit(msg);
  }
}
