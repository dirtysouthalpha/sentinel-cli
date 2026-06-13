/**
 * Command palette — Ctrl+K overlay (Phase 1, Task 1.4).
 *
 * Fuzzy-searchable overlay that indexes slash commands, themes, agents,
 * and model names. Triggered by Ctrl+K, dismissed by Escape.
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { state } from "../core/state.js";
import { fuzzyMatch } from "../core/fuzzy.js";
import { searchCatalog } from "../core/command-catalog.js";
import { getConfigManager } from "../core/config.js";

interface PaletteEntry {
  label: string;
  description?: string;
  category: "command" | "theme" | "agent" | "model";
  action: string; // what to execute
}

export interface PaletteCallbacks {
  onCommand: (name: string) => void;
  onTheme: (name: string) => void;
  onAgent: (name: string) => void;
  onModel: (name: string) => void;
}

export class CommandPalette {
  private box!: blessed.Widgets.BoxElement;
  private screen!: blessed.Widgets.Screen;
  private active = false;
  private query = "";
  private entries: PaletteEntry[] = [];
  private filtered: PaletteEntry[] = [];
  private selected = 0;
  private readonly callbacks: PaletteCallbacks;

  constructor(callbacks: PaletteCallbacks) {
    this.callbacks = callbacks;
  }

  init(screen: blessed.Widgets.Screen): void {
    this.screen = screen;
    const c = themeEngine.getBlessedColors();

    this.box = blessed.box({
      parent: screen,
      left: "10%",
      width: "80%",
      top: 4,
      height: 18,
      hidden: true,
      tags: true,
      border: { type: "line" },
      style: {
        bg: c.bgSecondary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });
  }

  isOpen(): boolean { return this.active; }

  /** Build the index and open the palette. */
  open(): void {
    this.buildIndex();
    this.query = "";
    this.selected = 0;
    this.filter();
    this.active = true;
    this.box.show();
    this.box.setFront();
    this.screen.render();
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.query = "";
    this.box.hide();
    this.screen.render();
  }

  /** Feed a keypress into the palette. Returns true if the palette consumed it. */
  handleKey(ch: string, code: number): boolean {
    if (!this.active) return false;

    if (code === 27) { // Escape
      this.close();
      return true;
    }
    if (code === 13 || code === 10) { // Enter
      this.accept();
      return true;
    }
    if (code === 9) { // Tab
      this.accept();
      return true;
    }
    if (code === 127 || code === 8) { // Backspace
      this.query = this.query.slice(0, -1);
      this.selected = 0;
      this.filter();
      return true;
    }
    if (ch === "[" || ch === "O") return true; // CSI prefix, swallow
    if (code >= 32) { // Printable
      this.query += ch;
      this.selected = 0;
      this.filter();
      return true;
    }
    // Up/down arrows come through handleCsi — delegate there
    return true; // swallow everything while open
  }

  handleCsi(seq: string): void {
    if (!this.active) return;
    const final = seq.slice(-1);
    if (final === "A" && this.selected > 0) { // up
      this.selected -= 1;
      this.renderItems();
    } else if (final === "B" && this.selected < this.filtered.length - 1) { // down
      this.selected += 1;
      this.renderItems();
    }
  }

  // ---- internals ------------------------------------------------------------

  private buildIndex(): void {
    this.entries = [];

    // Commands — from the live catalog with descriptions
    for (const c of searchCatalog("")) {
      this.entries.push({
        label: c.command,
        description: c.description,
        category: "command",
        action: c.command.split(/\s/)[0],
      });
    }

    // Themes
    for (const t of themeEngine.getAllThemes()) {
      this.entries.push({
        label: t.display,
        description: t.description,
        category: "theme",
        action: t.name,
      });
    }

    // Agents
    for (const a of ["gsd", "code", "ask", "plan", "debug"]) {
      this.entries.push({ label: `agent:${a}`, category: "agent", action: a });
    }

    // Models — read from live config so haiku/sonnet/opus/fable are current
    try {
      const cfg = getConfigManager().getAll();
      const providers = (cfg.provider || {}) as Record<string, { models?: Record<string, { name?: string }> }>;
      for (const [providerName, prov] of Object.entries(providers)) {
        for (const modelId of Object.keys(prov.models || {})) {
          const fullId = `${providerName}/${modelId}`;
          this.entries.push({ label: fullId, category: "model", action: fullId });
        }
      }
    } catch {
      // config not ready — skip model entries
    }
  }

  private filter(): void {
    const q = this.query.toLowerCase();
    if (!q) {
      this.filtered = this.entries.slice(0, 15);
    } else {
      const scored = this.entries
        .map((e) => {
          const m = fuzzyMatch(q, e.label.toLowerCase());
          return { entry: e, score: m ? m.score : 0 };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
      this.filtered = scored.map((r) => r.entry);
    }
    this.renderItems();
  }

  private renderItems(): void {
    const c = themeEngine.getBlessedColors();
    const catIcons: Record<string, string> = { command: "/", theme: "◆", agent: "→", model: "●" };
    const lines: string[] = [];

    // Header row: search prompt
    const queryDisplay = this.query ? this.esc(this.query) : `{${c.textTertiary}-fg}type to search…{/}`;
    lines.push(`{${c.cyan}-fg}❯{/} ${queryDisplay}{inverse} {/inverse}`);
    lines.push(`{${c.border}-fg}${"─".repeat(60)}{/}`);

    for (let i = 0; i < this.filtered.length; i++) {
      const e = this.filtered[i];
      const icon = catIcons[e.category] || " ";
      const labelPad = e.label.padEnd(22);
      const desc = e.description ? `{${i === this.selected ? c.textSecondary : c.textTertiary}-fg}${this.esc(e.description.slice(0, 55))}{/}` : "";
      const style = i === this.selected
        ? `{${c.accent || c.cyan}-fg}{bold}❯ ${icon}${this.esc(labelPad)}{/}${desc}`
        : `  {${c.textPrimary}-fg}${icon}${this.esc(labelPad)}{/}${desc}`;
      lines.push(style);
    }

    if (this.filtered.length === 0) {
      lines.push(`  {${c.textTertiary}-fg}No matches{/}`);
    }

    this.box.height = Math.min(lines.length + 2, 22);
    this.box.setContent(lines.join("\n"));
    this.screen.render();
  }

  private esc(s: string): string {
    return s.replace(/[{}]/g, (ch) => (ch === "{" ? "{open}" : "{close}"));
  }

  private accept(): void {
    const e = this.filtered[this.selected];
    this.close();
    if (!e) return;

    switch (e.category) {
      case "command":
        this.callbacks.onCommand(e.action);
        break;
      case "theme":
        this.callbacks.onTheme(e.action);
        break;
      case "agent":
        this.callbacks.onAgent(e.action);
        break;
      case "model":
        this.callbacks.onModel(e.action);
        break;
    }
  }
}
